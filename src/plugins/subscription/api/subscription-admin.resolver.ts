import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Allow, Ctx, ID, Permission, RequestContext, TransactionalConnection, Transaction } from "@vendure/core";

import { OrganizationSubscription } from "../entities/organization-subscription.entity";
import { SubscriptionPlan } from "../entities/subscription-plan.entity";
import { JuspaySubscriptionMandate } from "../entities/juspay-subscription-mandate.entity";
import { JuspayPaymentAttempt } from "../entities/juspay-payment-attempt.entity";
import { RenewalPaymentReconciliationRequired } from "../entities/juspay-reconciliation-required.entity";
import { SubscriptionService } from "../services/subscription.service";

@Resolver()
export class SubscriptionAdminResolver {
        constructor(
        private readonly subscriptionService: SubscriptionService,
        private readonly connection: TransactionalConnection,
    ) {}

  @Query()
  @Allow(Permission.SuperAdmin)
  async subscriptionPlans(@Ctx() ctx: RequestContext): Promise<SubscriptionPlan[]> {
    return this.subscriptionService.findAllPlans(ctx);
  }

      @Query()
  @Allow(Permission.SuperAdmin)
  async organizationSubscriptions(
    @Ctx() ctx: RequestContext,
  ): Promise<OrganizationSubscription[]> {
    return this.subscriptionService.findAllSubscriptions(ctx);
  }

    /**
   * Step 5: Read-only Juspay mandate ledger for a channel.
   * SEC-002: channel-isolated via the channelId filter argument.
   */
  @Query()
  @Allow(Permission.SuperAdmin)
  async juspayMandates(
    @Ctx() ctx: RequestContext,
    @Args("channelId") channelId: string,
    @Args("filter", { nullable: true }) filter?: { status?: string; subscriptionId?: ID },
    @Args("sort", { nullable: true }) sort?: { field: string; direction: "ASC" | "DESC" },
    @Args("pagination", { nullable: true }) pagination?: { skip?: number; take?: number },
  ): Promise<{ items: JuspaySubscriptionMandate[]; total: number }> {
    const qb = this.connection.rawConnection
      .getRepository(JuspaySubscriptionMandate)
      .createQueryBuilder("mandate")
      .where("mandate.channelId = :channelId", { channelId });

    if (filter?.status) {
      qb.andWhere("mandate.status = :status", { status: filter.status });
    }
    if (filter?.subscriptionId) {
      qb.andWhere("mandate.subscriptionId = :subscriptionId", { subscriptionId: filter.subscriptionId });
    }

    if (sort?.field) {
      qb.orderBy(`mandate.${sort.field}`, sort.direction ?? "DESC");
    }

    const skip = pagination?.skip ?? 0;
    const take = pagination?.take ?? 50;
    qb.skip(skip).take(take);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  /**
   * Step 5: Read-only Juspay payment attempt ledger for a channel.
   * INV-002: immutable financial facts — read-only, no mutations possible.
   */
  @Query()
  @Allow(Permission.SuperAdmin)
  async juspayPaymentAttempts(
    @Ctx() ctx: RequestContext,
    @Args("channelId") channelId: string,
    @Args("filter", { nullable: true }) filter?: { status?: string; invoiceId?: string; subscriptionId?: ID; billingPeriodStart?: string },
    @Args("sort", { nullable: true }) sort?: { field: string; direction: "ASC" | "DESC" },
    @Args("pagination", { nullable: true }) pagination?: { skip?: number; take?: number },
  ): Promise<{ items: JuspayPaymentAttempt[]; total: number }> {
    const qb = this.connection.rawConnection
      .getRepository(JuspayPaymentAttempt)
      .createQueryBuilder("attempt")
      .where("attempt.channelId = :channelId", { channelId });

    if (filter?.status) {
      qb.andWhere("attempt.status = :status", { status: filter.status });
    }
    if (filter?.invoiceId) {
      qb.andWhere("attempt.invoiceId = :invoiceId", { invoiceId: filter.invoiceId });
    }
    if (filter?.subscriptionId) {
      qb.andWhere("attempt.subscriptionId = :subscriptionId", { subscriptionId: filter.subscriptionId });
    }
    if (filter?.billingPeriodStart) {
      qb.andWhere("attempt.billingPeriodStart = :billingPeriodStart", { billingPeriodStart: filter.billingPeriodStart });
    }

    if (sort?.field) {
      qb.orderBy(`attempt.${sort.field}`, sort.direction ?? "DESC");
    }

    const skip = pagination?.skip ?? 0;
    const take = pagination?.take ?? 50;
    qb.skip(skip).take(take);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  /**
   * Step 5: Operator-visible reconciliation incidents (Step 4D).
   * Shows charges that succeeded at Juspay but could not be finalized —
   * requiring manual operator attention.
   */
  @Query()
  @Allow(Permission.SuperAdmin)
  async reconciliationIncidents(
    @Ctx() ctx: RequestContext,
    @Args("channelId", { nullable: true }) channelId?: string,
    @Args("status", { nullable: true }) status?: "PENDING" | "RESOLVED",
    @Args("pagination", { nullable: true }) pagination?: { skip?: number; take?: number },
  ): Promise<{ items: RenewalPaymentReconciliationRequired[]; total: number }> {
    const qb = this.connection.rawConnection
      .getRepository(RenewalPaymentReconciliationRequired)
      .createQueryBuilder("incident");

    if (channelId) {
      qb.where("incident.channelId = :channelId", { channelId });
    }
    if (status) {
      qb.andWhere("incident.status = :status", { status });
    }

    const skip = pagination?.skip ?? 0;
    const take = pagination?.take ?? 50;
    qb.skip(skip).take(take).orderBy("incident.detectedAt", "DESC");

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  @Transaction()
  @Mutation()
  @Allow(Permission.SuperAdmin)
  async createSubscriptionPlan(
    @Ctx() ctx: RequestContext,
    @Args("input") input: Partial<SubscriptionPlan>,
  ): Promise<SubscriptionPlan> {
    return this.subscriptionService.createPlan(ctx, input);
  }

  @Transaction()
  @Mutation()
  @Allow(Permission.SuperAdmin)
  async updateSubscriptionPlan(
    @Ctx() ctx: RequestContext,
    @Args("id") id: ID,
    @Args("input") input: Partial<SubscriptionPlan>,
  ): Promise<SubscriptionPlan> {
    return this.subscriptionService.updatePlan(ctx, id, input);
  }

  @Transaction()
  @Mutation()
  @Allow(Permission.SuperAdmin)
  async subscribeToPlan(
    @Ctx() ctx: RequestContext,
    @Args("channelId") channelId: string,
    @Args("planId") planId: ID,
  ): Promise<OrganizationSubscription> {
    return this.subscriptionService.subscribeToPlan(ctx, channelId, planId);
  }
}
