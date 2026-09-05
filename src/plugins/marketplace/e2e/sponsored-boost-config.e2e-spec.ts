/**
 * Pure unit tests for SponsoredBoostConfigService (Phase 3C.5).
 *
 * No server boot, no Elasticsearch, no DB — this only exercises the
 * fail-closed bounds parsing and the clamp so the bounded-bid-boost contract
 * is verifiable without ES infra (the live search query itself still needs
 * the infra-gated marketplace e2e).
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { SponsoredBoostConfigService } from '../services/sponsored-boost-config.service';

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

describe('SponsoredBoostConfigService (3C.5)', () => {
  it('defaults to [1.0, 5.0] when env is unset', () => {
    withEnv({ SPONSORED_BOOST_MIN: undefined, SPONSORED_BOOST_MAX: undefined }, () => {
      const svc = new SponsoredBoostConfigService();
      expect(svc.getMin()).toBe(1.0);
      expect(svc.getMax()).toBe(5.0);
    });
  });

  it('clamps a campaign boostWeight into the bounded window', () => {
    withEnv({ SPONSORED_BOOST_MIN: '1.0', SPONSORED_BOOST_MAX: '5.0' }, () => {
      const svc = new SponsoredBoostConfigService();
      // Inside the window → unchanged (the flat 3.0 default is now per-campaign).
      expect(svc.clampBoost(3.0)).toBe(3.0);
      // Below floor → 1.0 (never suppress a sponsored listing).
      expect(svc.clampBoost(0.1)).toBe(1.0);
      // Above ceiling → 5.0 (organic integrity preserved).
      expect(svc.clampBoost(999)).toBe(5.0);
      // Pathological inputs → neutral 1.0.
      expect(svc.clampBoost(NaN)).toBe(1.0);
      expect(svc.clampBoost(Infinity)).toBe(1.0);
    });
  });

  it('honors a custom bounded window [2.0, 8.0]', () => {
    withEnv({ SPONSORED_BOOST_MIN: '2.0', SPONSORED_BOOST_MAX: '8.0' }, () => {
      const svc = new SponsoredBoostConfigService();
      expect(svc.getMin()).toBe(2.0);
      expect(svc.getMax()).toBe(8.0);
      expect(svc.clampBoost(1.0)).toBe(2.0);
      expect(svc.clampBoost(100)).toBe(8.0);
      expect(svc.clampBoost(4.5)).toBe(4.5);
    });
  });

  it('fails closed on non-numeric input', () => {
    withEnv({ SPONSORED_BOOST_MIN: '5garbage', SPONSORED_BOOST_MAX: '5.0' }, () => {
      expect(() => new SponsoredBoostConfigService()).toThrow(/SPONSORED_BOOST_MIN/);
    });
  });

  it('fails closed when MIN is below 1 (would suppress sponsored listings)', () => {
    withEnv({ SPONSORED_BOOST_MIN: '0', SPONSORED_BOOST_MAX: '5.0' }, () => {
      expect(() => new SponsoredBoostConfigService()).toThrow(/must be >= 1/);
    });
  });

  it('fails closed when MAX < MIN (inverted window)', () => {
    withEnv({ SPONSORED_BOOST_MIN: '5.0', SPONSORED_BOOST_MAX: '2.0' }, () => {
      expect(() => new SponsoredBoostConfigService()).toThrow(/must be >= SPONSORED_BOOST_MIN/);
    });
  });
});