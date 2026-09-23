import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Allow, Ctx, ID, Permission, RequestContext, TransactionalConnection, Transaction } from "@vendure/core";

import { OrganizationSubscription } from "../entities/organization-subscription.entity";
import { SubscriptionPlan } from "../entities/subscription-plan.entity";
import { SubscriptionProviderBinding } from "../entities/subscription-provider-binding.entity";
import { SubscriptionBillingAttempt } from "../entities/subscription-billing-attempt.entity";
import { RenewalPaymentReconciliationRequired } from "../entities/renewal-reconciliation-required.entity";
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
   * Read-only provider mandate ledger for a channel.
   * SEC-002: channel-isolated via the channelId filter argument.
   */
  @Query()
  @Allow(Permission.SuperAdmin)
  async providerMandates(
    @Ctx() ctx: RequestContext,
    @Args("channelId") channelId: string,
    @Args("filter", { nullable: true }) filter?: { status?: string; subscriptionId?: ID },
    @Args("sort", { nullable: true }) sort?: { field: string; direction: "ASC" | "DESC" },
    @Args("pagination", { nullable: true }) pagination?: { skip?: number; take?: number },
    ): Promise<{ items: SubscriptionProviderBinding[]; total: number }> {
    const qb = this.connection.rawConnection
      .getRepository(SubscriptionProviderBinding)
      .createQueryBuilder("mandate")
      .where("mandate.channelId = :channelId", { channelId });

    if (filter?.status) {
      // Entity field is providerStatus (provider-neutral binding).
      qb.andWhere("mandate.providerStatus = :status", { status: filter.status });
    }
    if (filter?.subscriptionId) {
      qb.andWhere("mandate.subscriptionId = :subscriptionId", { subscriptionId: filter.subscriptionId });
    }

    if (sort?.field) {
      // Whitelist sortable fields (ProviderMandateSortField) — never interpolate
      // raw client input into ORDER BY.
      const sortable = ["createdAt", "providerStatus"] as const;
      if (!(sortable as readonly string[]).includes(sort.field)) {
        throw new Error(`Unsupported sort field: ${sort.field}`);
      }
      qb.orderBy(`mandate.${sort.field}`, sort.direction ?? "DESC");
    }

    const skip = pagination?.skip ?? 0;
    const take = pagination?.take ?? 50;
    qb.skip(skip).take(take);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  /**
   * Read-only provider payment attempt ledger for a channel.
   * INV-002: immutable financial facts — read-only, no mutations possible.
   */
  @Query()
  @Allow(Permission.SuperAdmin)
  async providerPaymentAttempts(
    @Ctx() ctx: RequestContext,
    @Args("channelId") channelId: string,
    @Args("filter", { nullable: true }) filter?: { status?: string; invoiceId?: string; subscriptionId?: ID; billingPeriodStart?: string },
    @Args("sort", { nullable: true }) sort?: { field: string; direction: "ASC" | "DESC" },
    @Args("pagination", { nullable: true }) pagination?: { skip?: number; take?: number },
    ): Promise<{ items: SubscriptionBillingAttempt[]; total: number }> {
    const qb = this.connection.rawConnection
      .getRepository(SubscriptionBillingAttempt)
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
      // Whitelist sortable fields (ProviderPaymentAttemptSortField).
      const sortable = ["attemptedAt", "amountPaise", "status"] as const;
      if (!(sortable as readonly string[]).includes(sort.field)) {
        throw new Error(`Unsupported sort field: ${sort.field}`);
      }
      qb.orderBy(`attempt.${sort.field}`, sort.direction ?? "DESC");
    }

    const skip = pagination?.skip ?? 0;
    const take = pagination?.take ?? 50;
    qb.skip(skip).take(take);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  /**
   * Operator-visible reconciliation incidents.
   * Shows charges that succeeded at the provider but could not be finalized —
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

  // ADR-039 external-side-effect ordering: deliberately NOT @Transaction().
  // The resolver-level transaction would hold a DB transaction open across
  // the external Razorpay HTTP call. Instead: validate (no tx) → provider
  // call (no tx) → one explicit narrow transaction for the local atomic
  // unit (OrganizationSubscription + SubscriptionProviderBinding).
  @Mutation()
  @Allow(Permission.SuperAdmin)
  async subscribeToPlan(
    @Ctx() ctx: RequestContext,
    @Args("channelId") channelId: string,
    @Args("planId") planId: ID,
  ): Promise<OrganizationSubscription> {
    return this.subscriptionService.subscribeToPlan(ctx, channelId, planId);
  }

  // ADR-044: supersede-in-place plan change. Same external-side-effect
  // ordering as subscribeToPlan — validate → provider calls → one narrow
  // local transaction (never a resolver-level @Transaction across HTTP).
  @Mutation()
  @Allow(Permission.SuperAdmin)
  async changeOrganizationSubscriptionPlan(
    @Ctx() ctx: RequestContext,
    @Args("channelId") channelId: string,
    @Args("planId") planId: ID,
  ): Promise<OrganizationSubscription> {
    return this.subscriptionService.changeOrganizationSubscriptionPlan(ctx, channelId, planId);
  }

  // ADR-044: local FSM cancellation. Immediate cancels transition the local
  // row and cancel at the provider when a binding exists; at-period-end
  // cancels set cancelAtPeriodEnd and let the renewal sweep / provider
  // webhook (markCancelledFromWebhook) complete the transition.
  @Mutation()
  @Allow(Permission.SuperAdmin)
  async cancelOrganizationSubscription(
    @Ctx() ctx: RequestContext,
    @Args("channelId") channelId: string,
    @Args("atPeriodEnd", { nullable: true, defaultValue: true }) atPeriodEnd?: boolean,
  ): Promise<OrganizationSubscription> {
    return this.subscriptionService.cancelOrganizationSubscription(ctx, channelId, atPeriodEnd ?? true);
  }
}
