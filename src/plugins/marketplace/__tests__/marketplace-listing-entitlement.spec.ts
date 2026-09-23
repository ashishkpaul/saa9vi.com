/**
 * ADR-042 / INV-024 — marketplace listing eligibility gate.
 *
 * Infrastructure-free by design (no Postgres, Redis or Elasticsearch): the
 * subscription source is a mocked TransactionalConnection and the ES client is a
 * spy. The REAL `CommercialEntitlementService` and the REAL
 * `MarketplaceIndexerService.indexSession()` are exercised, so this is a
 * behavioural proof of the ADR-042 window and the F7 gate. The infra-gated
 * end-to-end proof (real Postgres + real ES documents) lives in
 * `src/plugins/marketplace/e2e/marketplace.e2e-spec.ts`.
 *
 * Coverage (ADR-042 §4 + §6):
 *   – active plan-flagged channel            → document WRITTEN
 *   – plan.marketplaceListingEnabled = false → document REMOVED
 *   – no subscription row                    → document REMOVED
 *   – past_due INSIDE marketplaceGraceUntil  → document WRITTEN
 *   – past_due AFTER  marketplaceGraceUntil  → document REMOVED
 *   – past_due with NULL grace deadline      → document REMOVED
 *   – cancelled / pending_provider_auth      → document REMOVED
 *   – PROHIBITED signals cannot change the decision (customDomain, providerStatus)
 *   – F7 short-circuit: an ineligible *session* (PRIVATE/FINISHED) is pruned
 *     without reading subscription state at all
 */

import { describe, expect, it, vi } from 'vitest';
import { MarketplaceIndexerService } from '../services/marketplace-indexer.service';
import { CommercialEntitlementService } from '../../../platform/commercial/commercial-entitlement.service';
import { OrganizationSubscription } from '../../subscription/entities/organization-subscription.entity';

interface SubscriptionRow {
  channelId: string;
  status: string;
  marketplaceGraceUntil?: Date | null;
  providerStatus?: string | null;
  plan?: { marketplaceListingEnabled?: boolean } | null;
}

interface SessionRow {
  id: string;
  visibility: string;
  status: string;
  channelId: string | null;
  productVariantId: string | null;
}

const DAY = 86_400_000;

/** Builds the mocked DB surface for a single session + subscription state. */
function makeHarness(opts: {
  session: SessionRow | null;
  subscription?: SubscriptionRow | null;
  /** Deliberately irrelevant-to-eligibility metadata (ADR-042 §6 probes). */
  tenantProfile?: { businessName?: string; customDomain?: string | null } | null;
  channel?: { token: string } | null;
}) {
  const subscriptionReads: string[] = [];
  const subscriptions = opts.subscription
    ? [{ ...opts.subscription, plan: opts.subscription.plan ?? { marketplaceListingEnabled: true } }]
    : [];

  const subscriptionRepo = {
    findOne: vi.fn(async (q: any) => {
      const channelId = q?.where?.channelId;
      subscriptionReads.push(String(channelId));
      return subscriptions.find((s) => s.channelId === channelId) ?? null;
    }),
  };

  const sessionRow = opts.session
    ? {
        ...opts.session,
        title: 'Algebra 101',
        startTime: new Date(Date.now() + DAY),
        endTime: new Date(Date.now() + DAY + 3_600_000),
        subjectTags: ['math'],
      }
    : null;

  const connection = {
    rawConnection: {
      getRepository: vi.fn((entity: any) => {
        const name = entity?.name ?? '';
        if (name === 'OrganizationSubscription') return subscriptionRepo;
        if (name === 'BbbScheduledSession') return { findOne: vi.fn(async () => sessionRow) };
        if (name === 'TenantProfile') return { findOne: vi.fn(async () => opts.tenantProfile ?? null) };
        if (name === 'Channel') return { findOne: vi.fn(async () => opts.channel ?? null) };
        return { findOne: vi.fn(async () => null), find: vi.fn(async () => []) };
      }),
    },
  } as any;

  const baselineService = {
    getCurrentBaseline: vi.fn(async () => ({
      globalMean: 4.3,
      baselineVersion: 7,
      computedAt: new Date(),
    })),
  } as any;

  const configService = {
    entityIdStrategy: { encodeId: (id: any) => String(id), decodeId: (id: any) => Number(id) },
  } as any;

  const adService = { findActiveCampaignForSession: vi.fn(async () => null) } as any;

  const entitlements = new CommercialEntitlementService(connection);
  const indexer = new MarketplaceIndexerService(
    connection,
    adService,
    {} as any,
    baselineService,
    configService,
    {} as any,
    entitlements,
  );

  const index = vi.fn(async () => undefined);
  const del = vi.fn(async () => undefined);
  (indexer as any).client = { index, delete: del };

  return { indexer, index, del, subscriptionReads, entitlements };
}

const ctx = { channelId: '1' } as any;
const publicSession: SessionRow = {
  id: '1',
  visibility: 'PUBLIC',
  status: 'SCHEDULED',
  channelId: '1',
  productVariantId: null,
};
describe('ADR-042 policy — CommercialEntitlementService.channelMarketplaceEligible()', () => {
  const flagged = { marketplaceListingEnabled: true };

  const cases: Array<[string, SubscriptionRow | null, boolean]> = [
    ['active + plan flag → eligible', { channelId: '1', status: 'active', plan: flagged }, true],
    ['active + plan flag OFF → not eligible', { channelId: '1', status: 'active', plan: { marketplaceListingEnabled: false } }, false],
    ['active + plan row WITHOUT the column set → not eligible', { channelId: '1', status: 'active', plan: {} }, false],
    ['no subscription row → not eligible', null, false],
    ['past_due inside grace → eligible', { channelId: '1', status: 'past_due', marketplaceGraceUntil: new Date(Date.now() + DAY), plan: flagged }, true],
    ['past_due past grace → not eligible', { channelId: '1', status: 'past_due', marketplaceGraceUntil: new Date(Date.now() - DAY), plan: flagged }, false],
    ['past_due with NULL grace → not eligible (not an error)', { channelId: '1', status: 'past_due', marketplaceGraceUntil: null, plan: flagged }, false],
    ['cancelled even with live grace → not eligible', { channelId: '1', status: 'cancelled', marketplaceGraceUntil: new Date(Date.now() + DAY), plan: flagged }, false],
    ['pending_provider_auth → not eligible', { channelId: '1', status: 'pending_provider_auth', plan: flagged }, false],
    // ADR-042 admits {active} ∪ past_due∧grace — deliberately narrower than the
    // ADR-043 theming window, which admits trialing.
    ['trialing → not eligible (narrower than the theming window)', { channelId: '1', status: 'trialing', plan: flagged }, false],
  ];

  for (const [name, row, expected] of cases) {
    it(name, async () => {
      const h = makeHarness({ session: publicSession, subscription: row });
      expect(await h.entitlements.channelMarketplaceEligible('1')).toBe(expected);
    });
  }

  it('evaluates the deadline with the Saa9vi clock (injected), not provider time', async () => {
    const h = makeHarness({
      session: publicSession,
      subscription: { channelId: '1', status: 'past_due', marketplaceGraceUntil: new Date(Date.now() + DAY), plan: flagged },
    });
    expect(await h.entitlements.channelMarketplaceEligible('1', new Date())).toBe(true);
    expect(await h.entitlements.channelMarketplaceEligible('1', new Date(Date.now() + 2 * DAY))).toBe(false);
  });

  it('fails closed on an empty channelId without touching the database', async () => {
    const h = makeHarness({ session: publicSession });
    expect(await h.entitlements.channelMarketplaceEligible('')).toBe(false);
    expect(h.subscriptionReads).toHaveLength(0);
  });

  it('fails closed on a malformed grace deadline', async () => {
    const h = makeHarness({
      session: publicSession,
      subscription: { channelId: '1', status: 'past_due', marketplaceGraceUntil: 'not-a-date' as any, plan: flagged },
    });
    expect(await h.entitlements.channelMarketplaceEligible('1')).toBe(false);
  });
});
describe('ADR-042 §4 — MarketplaceIndexerService.indexSession() enforcement', () => {
  const flagged = { marketplaceListingEnabled: true };

  it('writes the document for an active, plan-flagged channel', async () => {
    const h = makeHarness({ session: publicSession, subscription: { channelId: '1', status: 'active', plan: flagged } });
    await h.indexer.indexSession('1', ctx);
    expect(h.index).toHaveBeenCalledTimes(1);
    expect(h.del).not.toHaveBeenCalled();
  });

  it('removes the document when the plan does not enable marketplace listing', async () => {
    const h = makeHarness({ session: publicSession, subscription: { channelId: '1', status: 'active', plan: { marketplaceListingEnabled: false } } });
    await h.indexer.indexSession('1', ctx);
    expect(h.index).not.toHaveBeenCalled();
    expect(h.del).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });

  it('removes the document when the channel has no subscription at all', async () => {
    const h = makeHarness({ session: publicSession, subscription: null });
    await h.indexer.indexSession('1', ctx);
    expect(h.index).not.toHaveBeenCalled();
    expect(h.del).toHaveBeenCalledTimes(1);
  });

  it('KEEPS the document for past_due inside the grace window', async () => {
    const h = makeHarness({ session: publicSession, subscription: { channelId: '1', status: 'past_due', marketplaceGraceUntil: new Date(Date.now() + DAY), plan: flagged } });
    await h.indexer.indexSession('1', ctx);
    expect(h.index).toHaveBeenCalledTimes(1);
    expect(h.del).not.toHaveBeenCalled();
  });

  it('REMOVES the document once the grace window has expired', async () => {
    const h = makeHarness({ session: publicSession, subscription: { channelId: '1', status: 'past_due', marketplaceGraceUntil: new Date(Date.now() - 1000), plan: flagged } });
    await h.indexer.indexSession('1', ctx);
    expect(h.index).not.toHaveBeenCalled();
    expect(h.del).toHaveBeenCalledTimes(1);
  });

  it('removes the document for a cancelled subscription even with a live grace deadline', async () => {
    const h = makeHarness({ session: publicSession, subscription: { channelId: '1', status: 'cancelled', marketplaceGraceUntil: new Date(Date.now() + DAY), plan: flagged } });
    await h.indexer.indexSession('1', ctx);
    expect(h.index).not.toHaveBeenCalled();
    expect(h.del).toHaveBeenCalledTimes(1);
  });

  // ── ADR-042 §6 — prohibited signals must not move the decision ─────────────
  it('providerStatus cannot rescue an ineligible subscription', async () => {
    const h = makeHarness({
      session: publicSession,
      subscription: { channelId: '1', status: 'past_due', marketplaceGraceUntil: new Date(Date.now() - DAY), providerStatus: 'authenticated', plan: flagged },
    });
    await h.indexer.indexSession('1', ctx);
    expect(h.index).not.toHaveBeenCalled();
    expect(h.del).toHaveBeenCalledTimes(1);
  });

  it('providerStatus cannot revoke an eligible subscription', async () => {
    const h = makeHarness({
      session: publicSession,
      subscription: { channelId: '1', status: 'active', providerStatus: 'halted', plan: flagged },
    });
    await h.indexer.indexSession('1', ctx);
    expect(h.index).toHaveBeenCalledTimes(1);
  });

  it('customDomain configuration has no bearing on eligibility (document content only)', async () => {
    const withDomain = makeHarness({
      session: publicSession,
      subscription: { channelId: '1', status: 'active', plan: flagged },
      tenantProfile: { businessName: 'Academy A', customDomain: 'academy-a.example.com' },
    });
    const withoutDomain = makeHarness({
      session: publicSession,
      subscription: { channelId: '1', status: 'active', plan: flagged },
      tenantProfile: { businessName: 'Academy A', customDomain: null },
    });
    await withDomain.indexer.indexSession('1', ctx);
    await withoutDomain.indexer.indexSession('1', ctx);
    expect(withDomain.index).toHaveBeenCalledTimes(1);
    expect(withoutDomain.index).toHaveBeenCalledTimes(1);
    expect(withDomain.del).not.toHaveBeenCalled();
    expect(withoutDomain.del).not.toHaveBeenCalled();
  });

  // ── F7 short-circuit (session gate runs BEFORE the subscription read) ─────
  it('prunes a PRIVATE session without reading subscription state', async () => {
    const h = makeHarness({ session: { ...publicSession, visibility: 'PRIVATE' }, subscription: { channelId: '1', status: 'active', plan: flagged } });
    await h.indexer.indexSession('1', ctx);
    expect(h.del).toHaveBeenCalledTimes(1);
    expect(h.subscriptionReads).toHaveLength(0);
    expect(h.index).not.toHaveBeenCalled();
  });

  it('prunes a FINISHED session without reading subscription state', async () => {
    const h = makeHarness({ session: { ...publicSession, status: 'FINISHED' }, subscription: { channelId: '1', status: 'active', plan: flagged } });
    await h.indexer.indexSession('1', ctx);
    expect(h.del).toHaveBeenCalledTimes(1);
    expect(h.subscriptionReads).toHaveLength(0);
  });

  it('a missing session row is a no-op (no gate evaluation, no write)', async () => {
    const h = makeHarness({ session: null, subscription: { channelId: '1', status: 'active', plan: flagged } });
    await h.indexer.indexSession('999', ctx);
    expect(h.index).not.toHaveBeenCalled();
    expect(h.del).not.toHaveBeenCalled();
  });
});


