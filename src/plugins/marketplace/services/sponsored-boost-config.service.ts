import { Injectable, Logger } from '@nestjs/common';

const loggerCtx = 'SponsoredBoostConfig';

/**
 * Fail-closed, env-driven bounds for the marketplace sponsored bid-boost
 * (3C.5). Replaces the former hardcoded `weight: 3.0` in the search resolver.
 *
 * Contract:
 *  - SPONSORED_BOOST_MIN (default 1.0): a sponsored listing is never boosted
 *    below 1.0, so it can never be suppressed relative to organic results.
 *  - SPONSORED_BOOST_MAX (default 5.0): the ceiling that preserves organic
 *    ranking integrity — no matter how large a campaign's `boostWeight` is
 *    set, the effective multiplier is clamped to this bound. The 3.0 default
 *    of the old flat weight is replaced by a tunable [1.0, 5.0] window.
 *
 * Validation is fail-closed (mirrors `MARKETPLACE_COMMISSION_PERCENT` in
 * CommissionLedgerService): any non-numeric, non-finite, or inconsistent
 * value aborts boot rather than silently producing an unbounded or inverted
 * boost. parseFloat('5garbage') === 5 is explicitly not acceptable here.
 */
@Injectable()
export class SponsoredBoostConfigService {
  private readonly logger = new Logger(loggerCtx);
  private readonly minBound: number;
  private readonly maxBound: number;

  constructor() {
    this.minBound = this.readBound('SPONSORED_BOOST_MIN', 1.0);
    this.maxBound = this.readBound('SPONSORED_BOOST_MAX', 5.0);
    if (!(this.minBound >= 1)) {
      throw new Error(
        `SPONSORED_BOOST_MIN must be >= 1 (a boost below 1 would suppress sponsored listings). Got ${this.minBound}.`
      );
    }
    if (!(this.maxBound >= this.minBound)) {
      throw new Error(`SPONSORED_BOOST_MAX (${this.maxBound}) must be >= SPONSORED_BOOST_MIN (${this.minBound}).`);
    }
    this.logger.log(`Sponsored bid-boost bounds: [${this.minBound}, ${this.maxBound}]`);
  }

  getMin(): number {
    return this.minBound;
  }

  getMax(): number {
    return this.maxBound;
  }

  /**
   * Clamp a raw campaign `boostWeight` into [min, max]. Any non-finite input
   * collapses to the neutral 1.0 (a pathological boost must never distort the
   * ranking). Sponsored docs default to 1.0 (neutral) when no campaign exists.
   */
  clampBoost(raw: number): number {
    if (!Number.isFinite(raw)) {
      return 1.0;
    }
    return Math.min(this.maxBound, Math.max(this.minBound, raw));
  }

  private readBound(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') {
      return fallback;
    }
    const trimmed = raw.trim();
    if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
      throw new Error(`${name} must be a non-negative number (got '${raw}').`);
    }
    return parseFloat(trimmed);
  }
}