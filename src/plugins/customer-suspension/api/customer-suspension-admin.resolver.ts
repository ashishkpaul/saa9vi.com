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
  IllegalOperationError,
} from "@vendure/core";
import { CustomerSuspensionService } from "../services/customer-suspension.service";
import { CustomerChannelStatus } from "../entities/customer-channel-status.entity";
import { CustomerStatusChangeLog } from "../entities/customer-status-change-log.entity";
import { CustomerSuspensionPermission } from "../constants";

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

  @Allow(Permission.SuperAdmin)
  @Transaction()
  @Mutation()
  async suspendCustomer(
    @Ctx() ctx: RequestContext,
    @Args("customerId") customerId: ID,
    @Args("reason", { nullable: true }) reason?: string,
  ): Promise<boolean> {
    await this.suspensionService.suspendPlatformWide(ctx, customerId, reason);
    return true;
  }

  @Allow(Permission.SuperAdmin)
  @Transaction()
  @Mutation()
  async reinstateCustomer(
    @Ctx() ctx: RequestContext,
    @Args("customerId") customerId: ID,
  ): Promise<boolean> {
    await this.suspensionService.reinstatePlatformWide(ctx, customerId);
    return true;
  }

  // ─── Channel-scoped Mutations ────────────────────────────────────────────────

  @Allow(CustomerSuspensionPermission.Permission)
  @Transaction()
  @Mutation()
  async suspendCustomerInChannel(
    @Ctx() ctx: RequestContext,
    @Args("customerId") customerId: ID,
    @Args("channelId") channelId: ID,
    @Args("reason", { nullable: true }) reason?: string,
  ): Promise<boolean> {
    // Channel validation: if not SuperAdmin, channelId must match the admin's assigned channel
    if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
      const adminChannelId = ctx.channelId as string;
      if (adminChannelId !== String(channelId)) {
        throw new IllegalOperationError(
          "You can only suspend customers in your assigned channel",
        );
      }
    }

    await this.suspensionService.suspendInChannel(
      ctx,
      customerId,
      String(channelId),
      reason,
    );
    return true;
  }

  @Allow(CustomerSuspensionPermission.Permission)
  @Transaction()
  @Mutation()
  async reinstateCustomerInChannel(
    @Ctx() ctx: RequestContext,
    @Args("customerId") customerId: ID,
    @Args("channelId") channelId: ID,
  ): Promise<boolean> {
    // Channel validation: if not SuperAdmin, channelId must match the admin's assigned channel
    if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
      const adminChannelId = ctx.channelId as string;
      if (adminChannelId !== String(channelId)) {
        throw new IllegalOperationError(
          "You can only reinstate customers in your assigned channel",
        );
      }
    }

    await this.suspensionService.reinstateInChannel(
      ctx,
      customerId,
      String(channelId),
    );
    return true;
  }

  @Query()
  @Allow(CustomerSuspensionPermission.Permission)
  async customerChannelStatus(
    @Ctx() ctx: RequestContext,
    @Args("customerId") customerId: ID,
    @Args("channelId") channelId: ID,
  ): Promise<CustomerChannelStatus | null> {
    // Channel validation: if not SuperAdmin, channelId must match the admin's assigned channel
    if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
      const adminChannelId = ctx.channelId as string;
      if (adminChannelId !== String(channelId)) {
        throw new IllegalOperationError(
          "You can only view status for your assigned channel",
        );
      }
    }

    return this.suspensionService.findChannelStatus(
      ctx,
      customerId,
      String(channelId),
    );
  }

  // customerChannelStatuses returns all channel status records for a customer.
  // This is inherently cross-channel data, so restrict to SuperAdmin only.
  @Query()
  @Allow(Permission.SuperAdmin)
  async customerChannelStatuses(
    @Ctx() ctx: RequestContext,
    @Args("customerId") customerId: ID,
  ): Promise<CustomerChannelStatus[]> {
    return this.suspensionService.listChannelStatuses(ctx, customerId);
  }
}
