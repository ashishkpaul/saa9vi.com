import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  Channel,
  EventBus,
  Logger,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbOrganizationService } from "../services/bbb-organization.service";
import { TenantRegisteredEvent } from "../../tenant-plugin/events/tenant-events";

const loggerCtx = "BbbTenantProvisioningListener";

/**
 * B-2 (G1 hostname contract): when a tenant self-serve registers, the BBB
 * plugin auto-provisions the channel's BbbOrganization with
 * slug === TenantProfile.tenantSlug.
 *
 * This makes BbbOrganization.slug a synchronized projection of the tenant
 * slug (never an independent identity source), so the marketplace academySlug
 * and the platform hostname `{tenantSlug}.saa9vi.com` can never diverge.
 *
 * Idempotent for repeated sequential delivery: creation is skipped if an org
 * already exists for the channel (BbbOrganizationService.create throws on an
 * existing channel org). Concurrent duplicate delivery is NOT proven safe by
 * the service alone — it relies on BbbOrganization's unique channelId column
 * index as the database guard (a concurrent second create would surface as a
 * unique violation and be logged, not thrown to the caller).
 */
@Injectable()
export class BbbTenantProvisioningListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBus,
    private readonly connection: TransactionalConnection,
    private readonly requestContextService: RequestContextService,
    private readonly bbbOrganizationService: BbbOrganizationService,
  ) {}

  onModuleInit() {
    this.eventBus.ofType(TenantRegisteredEvent).subscribe(async (event) => {
      try {
        const existing = await this.connection
          .getRepository(event.ctx, BbbOrganization)
          .findOne({ where: { channelId: event.channelId } });

        if (existing) {
          if (existing.slug === event.tenantSlug) {
            Logger.debug(
              `TenantRegisteredEvent: BbbOrganization already exists for channel ${event.channelId} with matching slug, skipping`,
              loggerCtx,
            );
            return;
          }
          // Pre-existing org with a different slug: synchronize it to the
          // tenant slug (G1 invariant — slug is a projection of tenantSlug).
          const stale = existing.slug;
          existing.slug = event.tenantSlug;
          await this.connection.getRepository(event.ctx, BbbOrganization).save(existing);
          Logger.warn(
            `TenantRegisteredEvent: synchronized pre-existing BbbOrganization.slug ("${stale}" -> "${event.tenantSlug}") for channel ${event.channelId}`,
            loggerCtx,
          );
          return;
        }

        // BbbOrganizationService.create uses assignToCurrentChannel(org, ctx),
        // so the ctx MUST be scoped to the tenant channel — a default-channel
        // ctx would mis-assign the org's channels manyToMany.
        const channel = await this.connection
          .getRepository(event.ctx, Channel)
          .findOne({ where: { id: event.channelId } });
        if (!channel) {
          Logger.error(
            `TenantRegisteredEvent: channel ${event.channelId} not found; BbbOrganization not provisioned`,
            loggerCtx,
          );
          return;
        }
        const orgCtx = await this.requestContextService.create({
          apiType: "admin",
          channelOrToken: channel,
        });

        await this.bbbOrganizationService.create(orgCtx, {
          channelId: event.channelId,
          tenantProfileId: event.tenantProfileId,
          name: event.businessName,
          slug: event.tenantSlug,
        });
        Logger.info(
          `TenantRegisteredEvent: provisioned BbbOrganization (slug="${event.tenantSlug}") for channel ${event.channelId}`,
          loggerCtx,
        );
      } catch (e: any) {
        Logger.error(
          `TenantRegisteredEvent: BbbOrganization provisioning failed for channel ${event.channelId}: ${e?.message}`,
          loggerCtx,
        );
      }
    });
  }
}
