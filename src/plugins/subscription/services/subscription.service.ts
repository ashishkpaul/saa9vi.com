import { Injectable, Inject } from "@nestjs/common";
import {
  Channel,
  DeepPartial,
  EventBus,
  ID,
  ListQueryBuilder,
  Logger,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";

import { loggerCtx, RECURRING_BILLING_PROVIDER } from "../constants";
import { OrganizationSubscription } from "../entities/organization-subscription.entity";
import { SubscriptionPlan } from "../entities/subscription-plan.entity";
import { SubscriptionProviderBinding } from "../entities/subscription-provider-binding.entity";
import { SubscriptionPlanChangedEvent } from "../events/subscription.events";
import {
  CreateRecurringSubscriptionInput,
  ProviderSubscription,
  RecurringBillingProvider,
} from "../providers/recurring-billing.provider";
import { TenantProfile } from "../../tenant-plugin/entities/tenant-profile.entity";

/**
 * Lifecycle service for tenant SaaS subscriptions.
 *
 * Owns: plan catalogue CRUD (Portal Admin), channel-scoped subscription
 * reads, provider-wired subscription creation (ADR-039: Razorpay
 * subscription + SubscriptionProviderBinding in one request path), and
 * the binding seam consumed by provider webhook processing.
 * Renewal/dunning live in SubscriptionRenewalService; the provider
 * is Razorpay (sole active provider — ADR-038).
 */
export interface TenantSelfServeSubscriptionPlanChangeResult {
  subscription: OrganizationSubscription;
  providerAuthorizationUrl: string | null;
}

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly listBuilder: ListQueryBuilder,
    // Provider-neutral per ADR-038/INV-019. Null only when the plugin runs
    // without a configured provider (dev without Redis-style fallbacks).
    @Inject(RECURRING_BILLING_PROVIDER)
    private readonly billingProvider: RecurringBillingProvider | null,
    private readonly eventBus: EventBus,
  ) {}

  async findAllPlans(ctx: RequestContext): Promise<SubscriptionPlan[]> {
    return this.connection.getRepository(ctx, SubscriptionPlan).find({
      order: { sortOrder: "ASC", name: "ASC" },
    });
  }

  async findPlan(ctx: RequestContext, id: ID): Promise<SubscriptionPlan | null> {
    return this.connection
      .getRepository(ctx, SubscriptionPlan)
      .findOne({ where: { id } });
  }

  /**
   * Plans are platform-global catalogue entries. Writes are SuperAdmin-only
   * (Portal Admin), enforced at the resolver layer.
   */
  async createPlan(
    ctx: RequestContext,
    input: Partial<SubscriptionPlan>,
  ): Promise<SubscriptionPlan> {
    const repo = this.connection.getRepository(ctx, SubscriptionPlan);
    const existing = await repo.findOne({ where: { slug: input.slug } });
    if (existing) {
      throw new Error(`SubscriptionPlan with slug '${input.slug}' already exists`);
    }
    const plan = await repo.save(repo.create(input));
    Logger.info(`Created SubscriptionPlan '${plan.name}' (${plan.id})`, loggerCtx);
    return plan;
  }

  async updatePlan(
    ctx: RequestContext,
    id: ID,
    input: Partial<SubscriptionPlan>,
  ): Promise<SubscriptionPlan> {
    const repo = this.connection.getRepository(ctx, SubscriptionPlan);
    const plan = await repo.findOne({ where: { id } });
    if (!plan) {
      throw new Error(`SubscriptionPlan ${id} not found`);
    }
    Object.assign(plan, input);
    const saved = await repo.save(plan);
    Logger.info(`Updated SubscriptionPlan '${saved.name}' (${saved.id})`, loggerCtx);
    return saved;
  }

  /**
   * All subscriptions across tenants (Portal Admin view).
   *
   * ExtendedListQueryOptions is `{ relations?, channelId?, ctx?, ... }` — all
   * keys optional, so a bare RequestContext type-checks but silently provides
   * nothing. `plan` must be explicitly joined here or GraphQL throws
   * "Cannot return null for non-nullable field OrganizationSubscription.plan"
   * on the first non-empty result.
   */
  async findAllSubscriptions(ctx: RequestContext): Promise<OrganizationSubscription[]> {
    return this.listBuilder
      .build(OrganizationSubscription, {}, { ctx, relations: ["plan"] })
      .getMany();
  }

  /** The subscription for a channel/tenant, if any. */
  async findSubscriptionByChannel(
    ctx: RequestContext,
    channelId: string,
  ): Promise<OrganizationSubscription | null> {
    return this.connection
      .getRepository(ctx, OrganizationSubscription)
      .findOne({ where: { channelId }, relations: ["plan"] });
  }

  /**
   * Subscribes a channel to a plan (INV-001/ADR-039).
   *
   * Channel assignment follows the ADR-036 house policy: tenant-scoped entities
   * are assigned to the TENANT channel only. The generic Vendure
   * `assignToCurrentChannel()` helper also joins the default channel, which
   * would leak the tenant's subscription onto the platform channel (BUG-031).
   * Assignment is therefore done inline (`channels = [channel]`).
   */
  async subscribeToPlan(
    ctx: RequestContext,
    channelId: string,
    planId: ID,
  ): Promise<OrganizationSubscription> {
    const repo = this.connection.getRepository(ctx, OrganizationSubscription);

    // ── 1. Validate local prerequisites (no side effects yet — ADR-039) ──
    const existing = await repo.findOne({ where: { channelId } });
    if (existing && existing.status !== "cancelled") {
      // Message matches the ACTUAL condition: ANY non-cancelled status occupies
      // the partial unique index slot (`status != 'cancelled'`), not just
      // active/trialing. Use changeOrganizationSubscriptionPlan to move plan,
      // or cancelOrganizationSubscription first.
      throw new Error(
        `Channel ${channelId} already has a non-cancelled subscription ` +
          `(status '${existing.status}'). Use changeOrganizationSubscriptionPlan to ` +
          `move it to another plan, or cancelOrganizationSubscription first.`,
      );
    }

    const plan = await this.connection
      .getRepository(ctx, SubscriptionPlan)
      .findOne({ where: { id: planId } });
    if (!plan) {
      throw new Error(`SubscriptionPlan ${planId} not found`);
    }

    // ADR-039: provider-wired creation; fail closed without a provider plan
    // mapping (no silent local-only fallback path exists any more).
    if (!plan.providerPlanId) {
      throw new Error(
        `SubscriptionPlan '${plan.name}' has no providerPlanId. ` +
          `Set it (Razorpay plan_id) via updateSubscriptionPlan before subscribing.`,
      );
    }
    if (!this.billingProvider) {
      throw new Error(`No recurring billing provider configured; cannot subscribe to plan '${plan.name}'`);
    }

    const channel = await this.connection.rawConnection
      .getRepository(Channel)
      .findOne({ where: { id: channelId } });
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // TenantProfile is 1:1 with the Channel (INV-001); its id is the
    // organization correlation reference in provider notes.
    const tenantProfile = await this.connection.rawConnection
      .getRepository(TenantProfile)
      .findOne({ where: { channelId } });
    if (!tenantProfile) {
      throw new Error(`No TenantProfile found for channel ${channelId}; cannot correlate organization`);
    }

    // ── 2. EXTERNAL, non-rollbackable: create the provider subscription ──
    const providerInput: CreateRecurringSubscriptionInput = {
      channelId,
      tenantProfileId: String(tenantProfile.id),
      planId: plan.providerPlanId,
    };
    const providerSub = await this.billingProvider.createSubscription(providerInput);

    // ── 3. Local persistence: ONE explicit narrow transaction covering the
    // atomic unit (OrganizationSubscription + SubscriptionProviderBinding).
    // A failure here rolls back BOTH rows; the provider subscription sub_XXX
    // remains as a pre-auth orphan and is surfaced for reconciliation
    // (ADR-039 external-side-effect model).
    const now = new Date();

    const saved = await this.connection.rawConnection.transaction(async (em) => {
      const sub = new OrganizationSubscription({
        channelId,
        plan,
        // ADR-039: pre-authorization state; only provider webhooks drive 'active'.
        status: "pending_provider_auth",
        // ADR-041: do NOT set currentPeriodStart/End from local clock here.
        // The authoritative billing period comes from the provider webhook
        // (current_start / current_end). Setting a local datetime now would
        // cause the cycle-monotonic CAS to reject the first webhook as "not newer"
        // when the YYYY-MM-DD target is earlier than the time-of-day component
        // stored here. NULL is the correct pre-auth value — the IS NULL branch
        // of the CAS fires correctly for the first provider webhook.
        currentPeriodStart: null as any,
        currentPeriodEnd: null as any,
        version: 1,
        providerStatus: providerSub.status,
        providerShortUrl: providerSub.shortUrl,
      });
      // INV-001 dual pattern: join-table membership + scalar channelId.
      sub.channels = [channel];
      await em.save(sub);

      // Binding created in the SAME request path and SAME transaction as the
      // subscription (ADR-039: the sole first-binding mechanism; the worker
      // stays fail-closed and absorbs any webhook that races this commit).
      const binding = new SubscriptionProviderBinding({
        subscription: sub,
        channelId,
        provider: this.billingProvider!.providerName,
        providerSubscriptionId: providerSub.providerSubscriptionId,
        providerPlanId: plan.providerPlanId,
        providerStatus: providerSub.status,
        active: false,
        metadata: { shortUrl: providerSub.shortUrl, tenantProfileId: String(tenantProfile.id) },
      });
      binding.channels = [channel];
      await em.save(binding);
      return sub;
    }).catch((err: unknown) => {
      // External-side-effect model (ADR-039): the provider subscription
      // sub_XXX remains as a pre-auth orphan — surface its ID for
      // reconciliation; it never charges without customer authorization.
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Subscription persisted-state failure after provider creation. ` +
          `ORPHAN provider subscription ${providerSub.providerSubscriptionId} ` +
          `(channel ${channelId}) must be reconciled/cancelled in the provider ` +
          `dashboard. Cause: ${msg}`,
      );
    });

    Logger.info(
      `Channel ${channelId} ('${channel.code}') subscribed to plan '${plan.name}' ` +
        `(pending_provider_auth; provider sub ${providerSub.providerSubscriptionId})`,
      loggerCtx,
    );
    this.announcePlanChange(ctx, saved, null, "subscribed");
    return saved;
  }

  /**
   * Announce that a channel's plan identity was established or changed.
   *
   * ADR-031 amendment (Decision 5): plan-derived tenant capacity
   * (`BbbOrganization.concurrentMeetingLimit`) converges from this event rather
   * than from listener ordering. Called AFTER the local transaction has
   * committed, so consumers observe the row that actually exists.
   *
   * Failure mode is deliberately warn-and-continue. Vendure's EventBus awaits
   * blocking handlers and does NOT swallow their errors, so an unguarded
   * `await publish()` would let a capacity-sync fault fail the subscription
   * mutation — inverting the dependency (a cache must never break the source of
   * truth). Lost events are healed by the BBB plugin's startup reconciliation
   * pass, which re-derives every organization from the same code path.
   *
   * Note this hands off to the non-blocking `ofType` subscribers the rest of
   * this codebase uses, so it is fire-and-forget by construction: it returns
   * without waiting for consumers, and convergence is eventual, not synchronous.
   */
  private announcePlanChange(
    ctx: RequestContext,
    subscription: OrganizationSubscription,
    previousPlanId: string | null,
    cause: SubscriptionPlanChangedEvent["cause"],
  ): void {
    const planId = subscription.plan ? String(subscription.plan.id) : "";
    if (!planId) {
      // Unreachable for a persisted row, but never publish a malformed event.
      Logger.warn(
        `Not announcing plan change for channel ${subscription.channelId}: ` +
          `subscription ${subscription.id} has no plan loaded`,
        loggerCtx,
      );
      return;
    }
    void this.eventBus
      .publish(
        new SubscriptionPlanChangedEvent(
          ctx,
          subscription,
          subscription.channelId,
          planId,
          previousPlanId,
          cause,
        ),
      )
      .catch((err: unknown) => {
        Logger.error(
          `SubscriptionPlanChangedEvent consumer failed for channel ${subscription.channelId} ` +
            `(plan ${planId}, cause ${cause}): ` +
            `${err instanceof Error ? err.message : String(err)}. ` +
            `Plan-derived capacity will be re-synced on the next subscription change ` +
            `or by the BBB startup reconciliation pass.`,
          loggerCtx,
        );
      });
  }

  /**
   * ADR-044: supersede-in-place plan change.
   *
   * One non-cancelled subscription per channel is an invariant (partial unique
   * index on `channelId` WHERE `status != 'cancelled'`), so a plan change
   * REWRITES the existing row's plan in one narrow transaction — never
   * cancel-then-create, which would strand the provider binding and break the
   * unique index mid-flight.
   *
   * External-side-effect ordering mirrors subscribeToPlan (ADR-039):
   *   1. validate local prerequisites (no side effects)
   *   2. provider calls (non-rollbackable)
   *   3. ONE explicit narrow local transaction covering the atomic unit
   *
   * Branches:
   *   free → paid / paid → paid : new provider subscription created; row →
   *     pending_provider_auth; the provider webhook drives → active
   *     (existing machinery — ADR-039/ADR-041).
   *   → free : row superseded to the provider-free plan with status 'active'
   *     (ADR-044 §4 — provider-free rows keep their period fields NULL and
   *     never call provider primitives).
   *
   * Idempotency: a change to the SAME plan short-circuits BEFORE any provider
   * call — it must never mint a duplicate provider subscription.
   */
  async changeOrganizationSubscriptionPlan(
    ctx: RequestContext,
    channelId: string,
    planId: ID,
  ): Promise<OrganizationSubscription> {
    const result = await this.changeOrganizationSubscriptionPlanInternal(
      ctx,
      channelId,
      planId,
      false,
    );
    return result.subscription;
  }

  /**
   * ADR-046: same plan-change domain operation for the Shop self-serve surface.
   * The transient provider authorization URL is returned only when this
   * invocation created the provider subscription requiring customer action.
   */
  async changeOrganizationSubscriptionPlanForSelfServe(
    ctx: RequestContext,
    channelId: string,
    planId: ID,
  ): Promise<TenantSelfServeSubscriptionPlanChangeResult> {
    return this.changeOrganizationSubscriptionPlanInternal(
      ctx,
      channelId,
      planId,
      true,
    );
  }

  private async changeOrganizationSubscriptionPlanInternal(
    ctx: RequestContext,
    channelId: string,
    planId: ID,
    requireAuthorizationUrl: boolean,
  ): Promise<TenantSelfServeSubscriptionPlanChangeResult> {
    const repo = this.connection.getRepository(ctx, OrganizationSubscription);
    const bindingRepo = this.connection.getRepository(ctx, SubscriptionProviderBinding);

    // ── 1. Validate local prerequisites (no side effects yet — ADR-039) ──
    const current = await repo.findOne({ where: { channelId }, relations: ["plan"] });
    if (!current) {
      throw new Error(`Channel ${channelId} has no subscription; use subscribeToPlan`);
    }
    if (current.status === "cancelled") {
      throw new Error(
        `Channel ${channelId} subscription is cancelled; use subscribeToPlan to start a new subscription`,
      );
    }
    const target = await this.connection
      .getRepository(ctx, SubscriptionPlan)
      .findOne({ where: { id: planId } });
    if (!target) {
      throw new Error(`SubscriptionPlan ${planId} not found`);
    }

    // Idempotent no-op: same plan. MUST short-circuit BEFORE any provider call
    // — otherwise every retry mints a duplicate provider subscription.
    if (String(current.plan.id) === String(target.id)) {
      return {
        subscription: current,
        providerAuthorizationUrl: null,
      };
    }

    // ADR-044 §5: the paid-upgrade direction is always allowed; a DOWNGRADE
    // (target strictly cheaper) is rejected while trialing.
    if (
      current.status === "trialing" &&
      target.monthlyPriceInPaise < current.plan.monthlyPriceInPaise
    ) {
      throw new Error(
        `Cannot change a trialing subscription to a lower-priced plan ` +
          `('${target.name}' < '${current.plan.name}'); cancel and re-subscribe instead`,
      );
    }

    // Wiring signal for the OUTGOING cycle. A binding row — in ANY active
    // state, since `active` is a provider-mirrored flag and not a wiring
    // indicator — means a provider subscription exists that must be stopped
    // from renewing. Legacy pre-ADR-039 rows may carry providerPlanId with no
    // binding at all, so plan.providerPlanId alone is not sufficient here.
    const currentBinding = await bindingRepo.findOne({
      where: { channelId },
      order: { createdAt: "DESC" },
    });

    // ── 2. EXTERNAL, non-rollbackable: create the new provider subscription ──
    let providerSub: ProviderSubscription | undefined;
    let tenantProfileId: string | undefined;
    if (target.providerPlanId) {
      if (!this.billingProvider) {
        throw new Error(
          `No recurring billing provider configured; cannot change to plan '${target.name}'`,
        );
      }
      const tenantProfile = await this.connection.rawConnection
        .getRepository(TenantProfile)
        .findOne({ where: { channelId } });
      if (!tenantProfile) {
        throw new Error(
          `No TenantProfile found for channel ${channelId}; cannot correlate organization`,
        );
      }
      tenantProfileId = String(tenantProfile.id);
      providerSub = await this.billingProvider.createSubscription({
        channelId,
        tenantProfileId,
        planId: target.providerPlanId,
      });

      if (requireAuthorizationUrl && !providerSub.shortUrl) {
        try {
          await this.billingProvider.cancelSubscription(
            providerSub.providerSubscriptionId,
            { cancelAtCycleEnd: false },
          );
        } catch (cancelErr) {
          throw new Error(
            `Provider created subscription ${providerSub.providerSubscriptionId} without an authorization URL, ` +
              `and cleanup failed: ${cancelErr instanceof Error ? cancelErr.message : String(cancelErr)}`,
          );
        }
        throw new Error(
          `Provider created subscription ${providerSub.providerSubscriptionId} without an authorization URL; ` +
            "self-serve authorization cannot continue",
        );
      }
    }

    // ── 2b. EXTERNAL: stop the OLD provider subscription from renewing. ──
    // Razorpay owns recurring execution — without this, the old subscription
    // auto-charges at its next cycle even though the tenant has moved plans.
    // cancelAtCycleEnd preserves any prepaid remainder of the current cycle.
    // (A free → paid change has no binding, so there is nothing to cancel.)
    //
    // Ordering note: this runs BEFORE the local transaction, matching
    // subscribeToPlan's external-side-effect model. If the local supersede
    // then fails, the worst case is a scheduled provider cancellation with a
    // stale local row — surfaced, not silent — rather than a double-billing
    // window.
    if (currentBinding && this.billingProvider) {
      await this.billingProvider.cancelSubscription(currentBinding.providerSubscriptionId, {
        cancelAtCycleEnd: true,
      });
    }

    // ── 3. ONE narrow transaction: supersede in place (ADR-044 §1) ──
    const channel = await this.connection.rawConnection
      .getRepository(Channel)
      .findOne({ where: { id: channelId } });
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const saved = await this.connection.rawConnection
      .transaction(async (em) => {
        const subRepo = em.getRepository(OrganizationSubscription);
        // Re-read under a write lock so the version CAS below cannot race a
        // concurrent renewal / plan change / cancellation on this channel.
        const managed = await subRepo.findOne({
          where: { id: current.id },
          lock: { mode: "pessimistic_write" },
        });
        if (!managed) {
          throw new Error(`Subscription ${current.id} disappeared during plan change`);
        }
        if (managed.status === "cancelled") {
          throw new Error(
            `Subscription ${current.id} was cancelled concurrently; use subscribeToPlan`,
          );
        }
        if (managed.version !== current.version) {
          throw new Error(
            `Subscription ${current.id} changed concurrently ` +
              `(expected version ${current.version}, found ${managed.version}); retry`,
          );
        }

        managed.plan = target;
        // ADR-044 §4: a provider-free target activates locally; a provider-wired
        // target re-enters pre-authorization (only the provider webhook drives
        // → active — ADR-039).
        managed.status = target.providerPlanId ? "pending_provider_auth" : "active";
        // ADR-041 / F-7: the authoritative billing cycle comes from the provider
        // webhook — never a local clock estimate. A provider-free row has no
        // billing period at all (NULL keeps it out of the paid renewal scan,
        // whose predicate is `status IN ('active','trialing') AND currentPeriodEnd < now`).
        managed.currentPeriodStart = null as any;
        managed.currentPeriodEnd = null as any;
        managed.cancelAtPeriodEnd = false;
        managed.providerStatus = (providerSub?.status ?? null) as any;
        managed.providerShortUrl = (providerSub?.shortUrl ?? null) as any;
        managed.version = managed.version + 1;
        await em.save(managed);

        // Retire the outgoing binding (append-only history is retained; only
        // `active` flips). A stale live binding would keep feeding provider
        // webhooks into this superseded row.
        if (currentBinding && currentBinding.active) {
          currentBinding.active = false;
          currentBinding.metadata = {
            ...(currentBinding.metadata ?? {}),
            supersededAt: new Date().toISOString(),
            supersededBy: providerSub
              ? providerSub.providerSubscriptionId
              : "provider-free plan",
          };
          await em.save(currentBinding);
        }

        // Bind the new provider subscription in the SAME transaction and the
        // SAME request path (ADR-039: the sole first-binding mechanism).
        if (providerSub) {
          const binding = new SubscriptionProviderBinding({
            subscription: managed,
            channelId,
            provider: this.billingProvider!.providerName,
            providerSubscriptionId: providerSub.providerSubscriptionId,
            providerPlanId: target.providerPlanId,
            providerStatus: providerSub.status,
            active: false,
            metadata: { shortUrl: providerSub.shortUrl, tenantProfileId },
          });
          // INV-001 / ADR-036: tenant channel only — deliberately NOT
          // assignToCurrentChannel(), which would also join the default
          // channel (BUG-031).
          binding.channels = [channel];
          await em.save(binding);
        }

        return managed;
      })
      .catch((err: unknown) => {
        if (providerSub) {
          // External-side-effect model (ADR-039): the new provider subscription
          // remains a pre-auth orphan — surface it for reconciliation.
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Plan-change persisted-state failure after provider creation. ` +
              `ORPHAN provider subscription ${providerSub.providerSubscriptionId} ` +
              `(channel ${channelId}) must be reconciled/cancelled in the provider ` +
              `dashboard. Cause: ${msg}`,
          );
        }
        throw err;
      });

    Logger.info(
      `Channel ${channelId} ('${channel.code}') changed plan ` +
        `'${current.plan.name}' -> '${target.name}' (supersede-in-place, ADR-044` +
        (providerSub
          ? `; new provider sub ${providerSub.providerSubscriptionId})`
          : `; provider-free)`),
      loggerCtx,
    );
    // Announce after commit so the plan-derived capacity cache converges on the
    // NEW plan (ADR-031 amendment; free → paid and paid → free both re-derive).
    this.announcePlanChange(ctx, saved, String(current.plan.id), "changed");
    return {
      subscription: saved,
      providerAuthorizationUrl: providerSub?.shortUrl ?? null,
    };
  }

  /**
   * ADR-044: local, FSM-aware cancellation.
   *
   *   atPeriodEnd = true  → schedule: the provider is told to cancel at cycle
   *     end (`cancelAtCycleEnd` — REQUIRED for provider-wired rows, otherwise
   *     Razorpay still charges the next cycle); the local row keeps status
   *     'active' with `cancelAtPeriodEnd = true`. Completion happens via the
   *     provider webhook (`markCancelledFromWebhook`) or the renewal sweep's
   *     ADR-044 branch — whichever arrives first. Idempotent.
   *   atPeriodEnd = false → immediate: provider cancelled now (when wired); the
   *     local row → 'cancelled' + `cancelledAt` in the same request path, so
   *     the local FSM never waits on a webhook. `markCancelledFromWebhook`
   *     remains the provider-confirmation bridge and no-ops on arrival.
   *   provider-free rows (`plan.providerPlanId` NULL) → no billing period
   *     exists, so BOTH variants cancel locally and immediately (ADR-044 §4:
   *     never call provider primitives for provider-free rows).
   *
   * External-side-effect ordering mirrors subscribeToPlan: provider call FIRST,
   * then one narrow local transaction. A provider failure leaves the local row
   * untouched (fail closed — we never mark a row cancelled while the provider
   * will still charge it).
   *
   * Idempotency: cancelling an already-'cancelled' row returns it unchanged.
   */
  async cancelOrganizationSubscription(
    ctx: RequestContext,
    channelId: string,
    atPeriodEnd = true,
  ): Promise<OrganizationSubscription> {
    const repo = this.connection.getRepository(ctx, OrganizationSubscription);
    const bindingRepo = this.connection.getRepository(ctx, SubscriptionProviderBinding);

    const sub = await repo.findOne({ where: { channelId }, relations: ["plan"] });
    if (!sub) {
      throw new Error(`Channel ${channelId} has no subscription`);
    }
    if (sub.status === "cancelled") {
      // Idempotent no-op: already terminal.
      return sub;
    }

    // ADR-044 §4 gives a definitive provider-free test. Otherwise a binding row
    // (in any active state — `active` is provider-mirrored, and pre-auth rows
    // created by subscribeToPlan carry active=false while still holding a real
    // provider subscription) identifies the provider subscription to cancel.
    const providerFree = !sub.plan?.providerPlanId;
    const binding = providerFree
      ? null
      : await bindingRepo.findOne({ where: { channelId }, order: { createdAt: "DESC" } });
    const providerWired = !providerFree && !!binding;

    if (providerWired && this.billingProvider) {
      // EXTERNAL first (non-rollbackable): Razorpay owns recurring execution.
      await this.billingProvider.cancelSubscription(binding!.providerSubscriptionId, {
        cancelAtCycleEnd: atPeriodEnd,
      });
    } else if (providerWired) {
      throw new Error(
        `No recurring billing provider configured; cannot cancel provider-wired subscription for channel ${channelId}`,
      );
    }

    // Provider-free rows have no billing period, so "at period end" is not
    // representable for them; a provider-wired row with no binding has no
    // provider subscription to schedule either. Both cancel immediately.
    const immediate = providerFree || !providerWired || !atPeriodEnd;

    // ── ONE narrow local transaction (locking + version CAS). ──
    const saved = await this.connection.rawConnection.transaction(async (em) => {
      const subRepo = em.getRepository(OrganizationSubscription);
      const managed = await subRepo.findOne({
        where: { id: sub.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!managed) {
        throw new Error(`Subscription ${sub.id} disappeared during cancellation`);
      }
      // Raced with a concurrent cancellation — idempotent no-op.
      if (managed.status === "cancelled") {
        return managed;
      }
      if (managed.version !== sub.version) {
        throw new Error(
          `Subscription ${sub.id} changed concurrently ` +
            `(expected version ${sub.version}, found ${managed.version}); retry`,
        );
      }

      if (!immediate) {
        // Scheduled: stay active until the period ends. The provider webhook
        // (markCancelledFromWebhook) or the renewal sweep's ADR-044 branch
        // completes the transition — the sweep is the safety net for webhook
        // loss, since the row is still discoverable (status active + a
        // non-NULL currentPeriodEnd).
        managed.cancelAtPeriodEnd = true;
      } else {
        // Immediate (explicit), or provider-free (no billing period to end at).
        managed.status = "cancelled";
        managed.cancelledAt = new Date();
        managed.cancelAtPeriodEnd = false;
      }
      managed.version = managed.version + 1;
      await em.save(managed);

      // Deactivate the binding only on immediate cancellation; a scheduled
      // cancel keeps it live until the provider confirms at cycle end (so the
      // provider's `subscription.cancelled` webhook still resolves to this row).
      if (binding && immediate) {
        binding.active = false;
        await em.save(binding);
      }

      return managed;
    });

    Logger.info(
      `Channel ${channelId} subscription ` +
        (immediate
          ? `cancelled immediately${providerFree ? " (provider-free)" : ""}`
          : `scheduled to cancel at period end`) +
        ` (ADR-044)`,
      loggerCtx,
    );
    return saved;
  }

  /**
   * Creates a SubscriptionProviderBinding linking an OrganizationSubscription
   * to a provider-specific subscription. This is the seam that connects the
   * domain subscription to the provider's webhook events.
   *
   * Primary caller: `subscribeToPlan()` (ADR-039) — binding creation at
   * subscription-creation time is the SOLE first-binding mechanism.
   *
   * Legacy caller: `RazorpayWebhookProcessor.updateBinding()` retains a
   * lazy-creation branch for pre-ADR-039 compat, but that branch is
   * unreachable through the production worker (the queue fails closed
   * before invoking the processor when no binding exists — C-1-A evidence).
   */
  async createProviderBinding(
    ctx: RequestContext,
    channelId: string,
    provider: string,
    providerSubscriptionId: string,
    providerPlanId: string,
    providerStatus: string,
    metadata?: DeepPartial<Record<string, unknown>>,
  ): Promise<SubscriptionProviderBinding> {
    const bindingRepo = this.connection.getRepository(ctx, SubscriptionProviderBinding);

    // Idempotency lookup keyed on the SAME tuple as the entity's uniqueness
    // contract: @Index(['provider', 'providerSubscriptionId'], { unique: true }).
    // Looking up providerSubscriptionId alone would conflate identical provider
    // IDs issued by different providers (the entity is deliberately
    // provider-neutral — INV-019).
    const existing = await bindingRepo.findOne({
      where: { provider, providerSubscriptionId },
    });
    if (existing) {
      return existing;
    }

    // Resolve the OrganizationSubscription for this channel
    const subRepo = this.connection.getRepository(ctx, OrganizationSubscription);
    const subscription = await subRepo.findOne({
      where: { channelId },
      relations: ["plan"],
    });
    if (!subscription) {
      throw new Error(
        `Cannot create SubscriptionProviderBinding: no OrganizationSubscription found for channel ${channelId}`,
      );
    }

    // Resolve the channel entity for INV-001 compliance
    const channel = await this.connection.rawConnection
      .getRepository(Channel)
      .findOne({ where: { id: channelId } });
    if (!channel) {
      throw new Error(`Cannot create SubscriptionProviderBinding: channel ${channelId} not found`);
    }

    const binding = new SubscriptionProviderBinding({
      subscription,
      channelId,
      provider,
      providerSubscriptionId,
      providerPlanId,
      providerStatus,
      active: false,
      metadata,
    });

    // ADR-036 house policy (INV-001: Channel = Tenant): tenant-scoped entities
    // are assigned to the TENANT channel only. Deliberately NOT
    // `assignToCurrentChannel()`, which also joins the default channel and would
    // leak the binding onto the platform channel (BUG-031).
    binding.channels = [channel];

    const saved = await bindingRepo.save(binding);
    Logger.info(
      `Created SubscriptionProviderBinding: channel=${channelId}, provider=${provider}, providerSub=${providerSubscriptionId}`,
      loggerCtx,
    );
    return saved;
  }
}
