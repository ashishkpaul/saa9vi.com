import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  Channel,
  EventBus,
  Logger,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";

import { TenantRegisteredEvent } from "../../tenant-plugin/events/tenant-events";
import { loggerCtx } from "../constants";
import { FreePlanProvisioningService } from "../services/free-plan-provisioning.service";

/**
 * Free Basic activation at registration (plan §3.2 / slice 4).
 *
 * Subscribes to the SAME seam the BBB plugin uses to provision a tenant's
 * BbbOrganization — `TenantProfileService.create()` publishes
 * `TenantRegisteredEvent` once the profile and hostname mapping exist — so the
 * subscription plugin owns its own entity without the tenant plugin depending on
 * it (.clinerules §1: event-driven, no tight coupling; the BBB plugin already
 * imports this event across plugin boundaries).
 *
 * Failure isolation: registration MUST NOT fail because the subscription step
 * failed. Every path is wrapped in try/catch and logged, and the service is
 * itself fail-soft. A missing Free Basic row is therefore silent at the API
 * layer but detectable in logs (error level) and, from slice 8, through the
 * tenant dashboard read contract.
 *
 * Ordering vs. `BbbTenantProvisioningListener` (same event, no guaranteed order):
 * this slice creates NO capacity grant, so the relative order does not matter
 * yet. It matters for slice 6's daily-allowance job, which is designed to
 * tolerate a not-yet-existing BbbOrganization — `BbbSubscriptionListener` drops
 * the grant and warns when the org is absent (F-1), and the daily job guarantees
 * eventual existence.
 */
@Injectable()
export class FreePlanProvisioningListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBus,
    private readonly connection: TransactionalConnection,
    private readonly requestContextService: RequestContextService,
    private readonly freePlanProvisioningService: FreePlanProvisioningService,
  ) {}

  onModuleInit() {
    this.eventBus.ofType(TenantRegisteredEvent).subscribe(async (event) => {
      try {
        const channel = await this.connection
          .getRepository(event.ctx, Channel)
          .findOne({ where: { id: event.channelId } });
        if (!channel) {
          Logger.error(
            `TenantRegisteredEvent: channel ${event.channelId} not found; ` +
              `Free Basic subscription not provisioned`,
            loggerCtx,
          );
          return;
        }

        // Channel-scoped admin context: OrganizationSubscription is a
        // tenant-scoped entity (INV-001), so the write must run under the
        // tenant's own channel — not the default Shop API channel the
        // registration request arrived on (the mistake BUG-021 recorded).
        const ctx = await this.requestContextService.create({
          apiType: "admin",
          channelOrToken: channel,
        });

        const sub = await this.freePlanProvisioningService.provisionForChannel(
          ctx,
          event.channelId,
        );

        if (!sub) {
          Logger.warn(
            `TenantRegisteredEvent: Free Basic subscription NOT provisioned for channel ` +
              `${event.channelId}. The tenant retains platform access but has no ` +
              `subscription row until the free plan exists and is configured ` +
              `(freePlanSlug).`,
            loggerCtx,
          );
        }
      } catch (e: any) {
        // Never rethrow: a subscription-side failure must not fail registration.
        Logger.error(
          `TenantRegisteredEvent: Free-plan provisioning failed for channel ` +
            `${event.channelId}: ${e?.message}`,
          loggerCtx,
        );
      }
    });
  }
}
