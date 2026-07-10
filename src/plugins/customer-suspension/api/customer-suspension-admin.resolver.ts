// src/plugins/customer-suspension/api/customer-suspension-admin.resolver.ts
// Admin API mutations for customer suspension management

import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import {
  Allow,
  Ctx,
  ID,
  Permission,
  RequestContext,
  Transaction,
} from "@vendure/core";
import { CustomerSuspensionService } from "../services/customer-suspension.service";
import { CustomerChannelStatus } from "../entities/customer-channel-status.entity";
import { CustomerStatusChangeLog } from "../entities/customer-status-change-log.entity";

@Resolver()
export class CustomerSuspensionAdminResolver {
  constructor(private readonly suspensionService: CustomerSuspensionService) {}

  // ─── Platform-wide Queries ───────────────────────────────────────────────────

  @Query()
  @Allow(Permission.SuperAdmin)
  async customerStatusChangeLogs(
    @Ctx() ctx: RequestContext,
    @Args("customerId", { nullable: true }) customerId?: ID,
    @Args("scope", { nullable: true }) scope?: string,
  ): Promise<CustomerStatusChangeLog[]> {
    return this.suspensionService.listStatusChanges(ctx, {
      customerId,
      scope: scope as any,
    });
  }

  // ─── Platform-wide Mutations ─────────────────────────────────────────────────

  @Mutation()
  @Allow(Permission.SuperAdmin)
  @Transaction()
  async suspendCustomer(
    @Ctx() ctx: RequestContext,
    @Args("customerId") customerId: ID,
    @Args("reason", { nullable: true }) reason?: string,
  ): Promise<boolean> {
    await this.suspensionService.suspendPlatformWide(ctx, customerId, reason);
    return true;
  }

  @Mutation()
  @Allow(Permission.SuperAdmin)
  @Transaction()
  async reinstateCustomer(
    @Ctx() ctx: RequestContext,
    @Args("customerId") customerId: ID,
  ): Promise<boolean> {
    await this.suspensionService.reinstatePlatformWide(ctx, customerId);
    return true;
  }

  // ─── Channel-scoped Mutations ────────────────────────────────────────────────

  @Mutation()
  @Allow(Permission.UpdateCustomer)
  @Transaction()
  async suspendCustomerInChannel(
    @Ctx() ctx: RequestContext,
    @Args("customerId") customerId: ID,
    @Args("channelId") channelId: ID,
    @Args("reason", { nullable: true }) reason?: string,
  ): Promise<boolean> {
    await this.suspensionService.suspendInChannel(
      ctx,
      customerId,
      String(channelId),
      reason,
    );
    return true;
  }

  @Mutation()
  @Allow(Permission.UpdateCustomer)
  @Transaction()
  async reinstateCustomerInChannel(
    @Ctx() ctx: RequestContext,
    @Args("customerId") customerId: ID,
    @Args("channelId") channelId: ID,
  ): Promise<boolean> {
    await this.suspensionService.reinstateInChannel(
      ctx,
      customerId,
      String(channelId),
    );
    return true;
  }

  @Query()
  @Allow(Permission.ReadCustomer)
  async customerChannelStatus(
    @Ctx() ctx: RequestContext,
    @Args("customerId") customerId: ID,
    @Args("channelId") channelId: ID,
  ): Promise<CustomerChannelStatus | null> {
    return this.suspensionService.findChannelStatus(
      ctx,
      customerId,
      String(channelId),
    );
  }

  @Query()
  @Allow(Permission.ReadCustomer)
  async customerChannelStatuses(
    @Ctx() ctx: RequestContext,
    @Args("customerId") customerId: ID,
  ): Promise<CustomerChannelStatus[]> {
    return this.suspensionService.listChannelStatuses(ctx, customerId);
  }
}
