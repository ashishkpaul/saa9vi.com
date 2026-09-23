import { TransactionalConnection } from '@vendure/core';
import { OrganizationSubscription, OrganizationSubscriptionStatus } from '../../subscription/entities/organization-subscription.entity';
import { SubscriptionPlan } from '../../subscription/entities/subscription-plan.entity';

/**
 * TEST-ONLY FIXTURE (repository writes against the isolated e2e schema) —
 * deliberately not GraphQL. The ADR-042/INV-024 matrix needs subscription
 * states that production workflows cannot produce on demand (a past_due row
 * whose marketplace grace deadline has already expired, a plan with listing
 * disabled while the session stays PUBLIC, etc.). This is not an operational
 * data-mutation procedure — Portal Admin reaches those states through the
 * plan catalogue and the subscription FSM.
 *
 * Why the marketplace suites need this at all: marketplace listing is a
 * SUBSCRIPTION ENTITLEMENT (ADR-042), so a channel with no subscription row is
 * delisted by design. Every channel that publishes PUBLIC sessions in these
 * suites must therefore be seeded as eligible in beforeAll, and the matrix
 * below then drives the ineligible states explicitly.
 */
export interface MarketplaceSubscriptionState {
  /** SubscriptionPlan.marketplaceListingEnabled (ADR-042 §2). */
  marketplaceListingEnabled?: boolean;
  /** Local FSM status. Defaults to 'active'. */
  status?: OrganizationSubscriptionStatus;
  /** OrganizationSubscription.marketplaceGraceUntil (ADR-042 §3). */
  marketplaceGraceUntil?: Date | null;
  /**
   * ADR-042 §6 probe — lets a test prove that provider state has NO bearing on
   * the eligibility decision, by writing a contradictory providerStatus.
   */
  providerStatus?: string;
}

const PLAN_SLUG = 'e2e-marketplace-entitlement';

/**
 * Normalises a channel id to the **internal** form the entities store.
 *
 * Under `TestingEntityIdStrategy` (testConfig) GraphQL returns encoded ids
 * (`T_2`), while entity columns — `BbbOrganization.channelId`,
 * `BbbScheduledSession.channelId`, and therefore the channel the marketplace
 * gate queries with — store the raw id (`2`). Production uses the
 * AutoIncrement strategy where both forms are identical, so this is an
 * e2e-only concern; without it the subscription row is keyed `T_2` and the
 * ADR-042 gate (queried with the session's `channelId` = `2`) finds no
 * subscription → the channel is delisted and every projection test fails.
 * Mirrors `BbbOrganizationService.toInternalId()` / `decodeId` semantics.
 */
function internalChannelId(channelId: string): string {
  return String(channelId).replace(/^T_/, '');
}

/** Upserts the shared e2e plan + the channel's subscription to the given state. */
export async function seedMarketplaceSubscription(
  connection: TransactionalConnection,
  channelId: string,
  state: MarketplaceSubscriptionState = {},
): Promise<void> {
  const planRepo = connection.rawConnection.getRepository(SubscriptionPlan);
  const subRepo = connection.rawConnection.getRepository(OrganizationSubscription);

  // Key the row the way sessions/orgs store it (internal form) — see
  // internalChannelId(): the ADR-042 gate queries with session.channelId.
  const internalId = internalChannelId(channelId);
  const marketplaceListingEnabled = state.marketplaceListingEnabled ?? true;
  const status = state.status ?? 'active';

  const existingPlan = await planRepo.findOne({ where: { slug: PLAN_SLUG } });
  const plan = existingPlan ?? new SubscriptionPlan();
  plan.name = plan.name ?? 'E2E Marketplace Entitlement';
  plan.slug = plan.slug ?? PLAN_SLUG;
  plan.marketplaceListingEnabled = marketplaceListingEnabled;
  await planRepo.save(plan);

  const existingSub = await subRepo.findOne({ where: { channelId: internalId } });
  const sub = existingSub ?? new OrganizationSubscription();
  sub.channelId = internalId;
  sub.plan = plan;
  sub.status = status;
  sub.marketplaceGraceUntil = state.marketplaceGraceUntil ?? null;
  if (state.providerStatus !== undefined) sub.providerStatus = state.providerStatus;
  await subRepo.save(sub);
}

/**
 * Removes the channel's subscription entirely — the ADR-042 "no subscription
 * row" case, which must produce `false` rather than an error.
 */
export async function clearMarketplaceSubscription(
  connection: TransactionalConnection,
  channelId: string,
): Promise<void> {
  await connection.rawConnection
    .getRepository(OrganizationSubscription)
    .delete({ channelId: internalChannelId(channelId) });
}
