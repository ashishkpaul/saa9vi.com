import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export interface MarketplaceAttributionRef {
  resourceType: 'session' | 'plan';
  resourceId: string;
  channelId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

/**
 * Marketplace attribution service (Phase 3B.1).
 *
 * Signs and verifies an opaque, HMAC-signed marketplaceRef for Stream 2
 * commission attribution (ADR-021 addendum; INV-008). STATELESS: it only proves
 * "is this a cryptographically valid attribution claim for this channel/resource?"
 * It does NOT decide whether the resource actually maps to an order — that mapping
 * (resource identity -> ProductVariant/order; e.g. session:<productVariantId>) lives
 * in the commerce layer (resolver/listener): NOT here. Replay consumption (Decision6)
 * also lives in the listener, against the (marketplaceRef,orderId) unique
 * CommissionLedger index.

 * Secret read from process.env.MARKETPLACE_REF_SIGNING_SECRET (server-only). For
 * platform config consistency this could later be re-injected via Vendure config/ConfigService;
 * direct-env remains adequate here since env is fixed at boot. Fail-closed: bad or
 * expired refs -> null -> the caller maps to orderSource='direct' (never a blocking throw).
 */
@Injectable()
export class MarketplaceAttributionService {
  private static readonly VERSION = 1;
  private static readonly TTL_MS = 30 * 60 * 1000;
  private static readonly SKEW_MS = 30 * 1000;

  constructor() {
    if (!this.signingSecret()) {
      throw new Error(
        'MarketplaceAttributionService: MARKETPLACE_REF_SIGNING_SECRET is not set.'
      );
    }
  }

  private signingSecret(): string {
    return process.env.MARKETPLACE_REF_SIGNING_SECRET ?? '';
  }

  private sign(payload: string): Buffer {
    return createHmac('sha256', this.signingSecret()).update(payload, 'utf8').digest();
  }

  issueRef(input:{
    resourceType: 'session' | 'plan';
    resourceId: string;
    channelId: string;
  }): string {
    if (input.resourceType !== 'session' && input.resourceType !== 'plan') {
      throw new Error('MarketplaceAttributionService.issueRef: resourceType must be session or plan.');
    }
    if (!input.resourceId || typeof input.resourceId !== 'string') {
      throw new Error('MarketplaceAttributionService.issueRef: resourceId must be a non-empty string.');
    }
    if (!input.channelId || typeof input.channelId !== 'string') {
      throw new Error('MarketplaceAttributionService.issueRef: channelId must be a non-empty string.');
    }
    const issuedAt = Date.now();
    const expiresAt = issuedAt + MarketplaceAttributionService.TTL_MS;
    const nonce = randomBytes(16).toString('hex');
    const payload = JSON.stringify({
      v: MarketplaceAttributionService.VERSION,
      t: input.resourceType,
      r: input.resourceId,
      c: input.channelId,
      i: issuedAt,
      e: expiresAt,
      n: nonce,
    });
    const sig = this.sign(payload);
    const token = Buffer.from(payload, 'utf8').toString('base64url');
    const sigEnc = sig.toString('base64url');
    return token + '.' + sigEnc;
  }

  resolveRef(ref: string, expectedChannelId: string): MarketplaceAttributionRef | null {
    if (!ref || typeof ref !== 'string') return null;
    if (!this.signingSecret()) return null;
    const parts = ref.split('.');
    if (parts.length !== 2) return null;
    const tokenEnc = parts[0];
    const sigEnc = parts[1];
    if (!tokenEnc || !sigEnc) return null;

    let payload: string;
    try {
      payload = Buffer.from(tokenEnc, 'base64url').toString('utf8');
    } catch {
      return null;
    }

    let provided: Buffer;
    try {
      provided = Buffer.from(sigEnc, 'base64url');
    } catch {
      return null;
    }
    const expected = this.sign(payload);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return null;
    }

    let data: any;
    try {
      data = JSON.parse(payload);
    } catch {
      return null;
    }
    if (data === null || typeof data !== 'object') return null;

    if (data.v !== MarketplaceAttributionService.VERSION) return null;
    if (typeof data.t !== 'string' || typeof data.r !== 'string' || typeof data.c !== 'string') return null;
    if (typeof data.i !== 'number' || typeof data.e !== 'number' || typeof data.n !== 'string') return null;
    if (!data.r || !data.c || !data.n) return null;
    if (data.t !== 'session' && data.t !== 'plan') return null;
    if (data.c !== expectedChannelId) return null;

    const now = Date.now();
    if (data.i > now + MarketplaceAttributionService.SKEW_MS) return null;
    if (data.e <= now - MarketplaceAttributionService.SKEW_MS) return null;
    if (data.e <= data.i) return null;

    return {
      resourceType: data.t,
      resourceId: data.r,
      channelId: data.c,
      issuedAt: data.i,
      expiresAt: data.e,
      nonce: data.n,
    };
  }
}
