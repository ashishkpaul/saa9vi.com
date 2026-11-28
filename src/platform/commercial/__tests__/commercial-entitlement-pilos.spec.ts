/**
 * ADR-057 D4/D5 — PILOS access entitlement gate.
 * Infrastructure-free by design: mocked TransactionalConnection, REAL CommercialEntitlementService.
 */

import { describe, expect, it, vi } from 'vitest';
import { CommercialEntitlementService } from '../commercial-entitlement.service';

interface SubscriptionRow {
  channelId: string;
  status: string;
  marketplaceGraceUntil?: Date | null;
  plan?: { pilosAccessEnabled?: boolean; marketplaceListingEnabled?: boolean } | null;
}

const DAY = 86_400_000;

function makeHarness(opts: {
  subscription?: SubscriptionRow | null;
}) {
  const subscriptions = opts.subscription
    ? [
        {
          ...opts.subscription,
          plan: opts.subscription.plan ?? { pilosAccessEnabled: true, marketplaceListingEnabled: false },
        },
      ]
    : [];

  const subscriptionRepo = {
    findOne: vi.fn(async (q: any) => {
      const channelId = q?.where?.channelId;
      return subscriptions.find((s) => s.channelId === channelId) ?? null;
    }),
  };

  const connection = {
    rawConnection: {
      getRepository: vi.fn((entity: any) => {
        const name = entity?.name ?? '';
        if (name === 'OrganizationSubscription') return subscriptionRepo;
        return { findOne: vi.fn(async () => null), find: vi.fn(async () => []) };
      }),
    },
  } as any;

  const entitlements = new CommercialEntitlementService(connection);
  return { entitlements };
}

const pilosFlagged = { pilosAccessEnabled: true, marketplaceListingEnabled: false };
const marketplaceOnlyFlagged = { pilosAccessEnabled: false, marketplaceListingEnabled: true };
const bothFlagged = { pilosAccessEnabled: true, marketplaceListingEnabled: true };
describe('ADR-057 policy: channelPiloslAccessEligible()', () => {
  const cases: Array<[string, SubscriptionRow | null, boolean]> = [
    ['active + plan flag → eligible', { channelId: '1', status: 'active', plan: pilosFlagged }, true],
    ['active + plan flag OFF → not eligible', { channelId: '1', status: 'active', plan: { pilosAccessEnabled: false } }, false],
    ['active + plan row WITHOUT column → not eligible', { channelId: '1', status: 'active', plan: {} }, false],
    ['no subscription row → not eligible', null, false],
    ['past_due inside grace → eligible', { channelId: '1', status: 'past_due', marketplaceGraceUntil: new Date(Date.now() + DAY), plan: pilosFlagged }, true],
    ['past_due past grace → not eligible', { channelId: '1', status: 'past_due', marketplaceGraceUntil: new Date(Date.now() - DAY), plan: pilosFlagged }, false],
    ['past_due with NULL grace → not eligible', { channelId: '1', status: 'past_due', marketplaceGraceUntil: null, plan: pilosFlagged }, false],
    ['cancelled even with live grace → not eligible', { channelId: '1', status: 'cancelled', marketplaceGraceUntil: new Date(Date.now() + DAY), plan: pilosFlagged }, false],
    ['pending_provider_auth → not eligible', { channelId: '1', status: 'pending_provider_auth', plan: pilosFlagged }, false],
    ['trialing → not eligible', { channelId: '1', status: 'trialing', plan: pilosFlagged }, false],
  ];

  for (const [name, row, expected] of cases) {
    it(name, async () => {
      const h = makeHarness({ subscription: row });
      expect(await h.entitlements.channelPiloslAccessEligible('1')).toBe(expected);
    });
  }

  it('evaluates deadline with injected Saa9vi clock', async () => {
    const h = makeHarness({
      subscription: { channelId: '1', status: 'past_due', marketplaceGraceUntil: new Date(Date.now() + DAY), plan: pilosFlagged },
    });
    expect(await h.entitlements.channelPiloslAccessEligible('1', new Date())).toBe(true);
    expect(await h.entitlements.channelPiloslAccessEligible('1', new Date(Date.now() + 2 * DAY))).toBe(false);
  });

  it('fails closed on empty channelId without DB access', async () => {
    const h = makeHarness({});
    expect(await h.entitlements.channelPiloslAccessEligible('')).toBe(false);
  });

  it('fails closed on malformed grace deadline', async () => {
    const h = makeHarness({
      subscription: { channelId: '1', status: 'past_due', marketplaceGraceUntil: 'not-a-date' as any, plan: pilosFlagged },
    });
    expect(await h.entitlements.channelPiloslAccessEligible('1')).toBe(false);
  });
});

describe('ADR-057: PILOS access is SEPARATE from marketplace listing', () => {
  it('PILOS-eligible without marketplace listing', async () => {
    const h = makeHarness({
      subscription: { channelId: '1', status: 'active', plan: pilosFlagged },
    });
    expect(await h.entitlements.channelPiloslAccessEligible('1')).toBe(true);
    expect(await h.entitlements.channelMarketplaceEligible('1')).toBe(false);
  });

  it('marketplace-eligible without PILOS access', async () => {
    const h = makeHarness({
      subscription: { channelId: '1', status: 'active', plan: marketplaceOnlyFlagged },
    });
    expect(await h.entitlements.channelMarketplaceEligible('1')).toBe(true);
    expect(await h.entitlements.channelPiloslAccessEligible('1')).toBe(false);
  });

  it('eligible for both when both flags set', async () => {
    const h = makeHarness({
      subscription: { channelId: '1', status: 'active', plan: bothFlagged },
    });
    expect(await h.entitlements.channelPiloslAccessEligible('1')).toBe(true);
    expect(await h.entitlements.channelMarketplaceEligible('1')).toBe(true);
  });

  it('eligible for neither when neither flag set', async () => {
    const h = makeHarness({
      subscription: { channelId: '1', status: 'active', plan: { pilosAccessEnabled: false, marketplaceListingEnabled: false } },
    });
    expect(await h.entitlements.channelPiloslAccessEligible('1')).toBe(false);
    expect(await h.entitlements.channelMarketplaceEligible('1')).toBe(false);
  });
});

