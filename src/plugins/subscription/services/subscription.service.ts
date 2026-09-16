import { Injectable, Inject } from "@nestjs/common";
import {
  Channel,
  ChannelService,
  DeepPartial,
  ID,
  ListQueryBuilder,
  Logger,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";

import { loggerCtx, RECURRING_BILLING_PROVIDER } from "../constants";
import { OrganizationSubscription } from "../entities/organization-subscription.entity";
import { SubscriptionPlan } from "../entities/subscription-plan.entity";
import { SubscriptionProviderBinding } from "../entities/subscription-provider-binding.entity";
import {
  CreateRecurringSubscriptionInput,
  RecurringBillingProvider,
} from "../providers/recurring-billing.provider";
import { TenantProfile } from "../../tenant-plugin/entities/tenant-profile.entity";

/**
 * Lifecycle service for tenant SaaS subscriptions (Phase 2).
 *
 * Scope of this increment: plan catalogue CRUD (Portal Admin) and
 * channel-scoped subscription reads. Renewal/dunning jobs and the Juspay
 * integration land in subsequent increments — this service is intentionally
 * the seam they will plug into.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly listBuilder: ListQueryBuilder,
    private readonly channelService: ChannelService,
    private readonly requestContextService: RequestContextService,
    // Provider-neutral per ADR-038/INV-019. Null only when the plugin runs
    // without a configured provider (dev without Redis-style fallbacks).
    @Inject(RECURRING_BILLING_PROVIDER)
    private readonly billingProvider: RecurringBillingProvider | null,
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
   * Subscribes a channel to a plan (INV-001/ADR-003).
   * Populates both the join table (assignToCurrentChannel) and the scalar channelId.
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
      throw new Error(`Channel ${channelId} already has an active or trialing subscription`);
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

    // ── 3. Local persistence (inside the mutation's transaction) ──
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const sub = new OrganizationSubscription({
      channelId,
      plan,
      // ADR-039: pre-authorization state; only provider webhooks drive 'active'.
      status: "pending_provider_auth",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      version: 1,
      providerStatus: providerSub.status,
      providerShortUrl: providerSub.shortUrl,
    });

    // Ensure the entity is assigned to the target channel (INV-001)
    const targetCtx = await this.requestContextService.create({
      apiType: "admin",
      channelOrToken: channel,
    });

    await this.channelService.assignToCurrentChannel(sub, targetCtx);

    let saved: OrganizationSubscription;
    try {
      saved = await repo.save(sub);
      // Binding created in the SAME request path, before returning success
      // (ADR-039: the sole first-binding mechanism; the worker stays
      // fail-closed and absorbs any webhook that races this commit).
      await this.createProviderBinding(
        ctx,
        channelId,
        this.billingProvider.providerName,
        providerSub.providerSubscriptionId,
        plan.providerPlanId,
        providerSub.status,
        { shortUrl: providerSub.shortUrl, tenantProfileId: tenantProfile.id },
      );
    } catch (err: unknown) {
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
    }

    Logger.info(
      `Channel ${channelId} ('${channel.code}') subscribed to plan '${plan.name}' ` +
        `(pending_provider_auth; provider sub ${providerSub.providerSubscriptionId})`,
      loggerCtx,
    );
    return saved;
  }

  /**
   * Creates a SubscriptionProviderBinding linking an OrganizationSubscription
   * to a provider-specific subscription. This is the seam that connects the
   * domain subscription to the provider's webhook events.
   *
   * Called by RazorpayWebhookProcessor when the first subscription lifecycle
   * event arrives (authenticated/activated), ensuring webhook lookups succeed
   * rather than silently no-op'ing.
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

    // Idempotency: return existing binding if one already exists
    const existing = await bindingRepo.findOne({
      where: { providerSubscriptionId },
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

    // Assign to channel (INV-001: Channel = Tenant)
    const targetCtx = await this.requestContextService.create({
      apiType: "admin",
      channelOrToken: channel,
    });
    await this.channelService.assignToCurrentChannel(binding, targetCtx);

    const saved = await bindingRepo.save(binding);
    Logger.info(
      `Created SubscriptionProviderBinding: channel=${channelId}, provider=${provider}, providerSub=${providerSubscriptionId}`,
      loggerCtx,
    );
    return saved;
  }
}
