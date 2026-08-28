import { Injectable } from "@nestjs/common";
import {
  Channel,
  ChannelService,
  ID,
  ListQueryBuilder,
  Logger,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";

import { loggerCtx } from "../constants";
import { OrganizationSubscription } from "../entities/organization-subscription.entity";
import { SubscriptionPlan } from "../entities/subscription-plan.entity";

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

    // 1. Check for existing subscription
    const existing = await repo.findOne({ where: { channelId } });
    if (existing && existing.status !== "cancelled") {
      throw new Error(`Channel ${channelId} already has an active or trialing subscription`);
    }

    // 2. Resolve plan
    const plan = await this.connection
      .getRepository(ctx, SubscriptionPlan)
      .findOne({ where: { id: planId } });
    if (!plan) {
      throw new Error(`SubscriptionPlan ${planId} not found`);
    }

    // 3. Resolve channel
    const channel = await this.connection.rawConnection
      .getRepository(Channel)
      .findOne({ where: { id: channelId } });
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    // 4. Create and assign
    const sub = new OrganizationSubscription({
      channelId,
      plan,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      version: 1,
    });

    // Ensure the entity is assigned to the target channel (INV-001)
    const targetCtx = await this.requestContextService.create({
      apiType: "admin",
      channelOrToken: channel,
    });

    await this.channelService.assignToCurrentChannel(sub, targetCtx);

    const saved = await repo.save(sub);
    Logger.info(
      `Channel ${channelId} ('${channel.code}') subscribed to plan '${plan.name}'`,
      loggerCtx,
    );
    return saved;
  }
}
