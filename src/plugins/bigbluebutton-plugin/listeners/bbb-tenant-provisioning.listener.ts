import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import {
  Channel,
  EventBus,
  Logger,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbRoom } from "../entities/bbb-room.entity";
import { BbbOrganizationService } from "../services/bbb-organization.service";
import { BbbRoomService } from "../services/bbb-room.service";
import { BBB_PLUGIN_OPTIONS, DEFAULT_SEEDED_ROOM_NAMES } from "../constants";
import type { BigBlueButtonPluginOptions } from "../types";
import { TenantRegisteredEvent } from "../../tenant-plugin/events/tenant-events";

const loggerCtx = "BbbTenantProvisioningListener";

/**
 * B-2 (G1 hostname contract): when a tenant self-serve registers, the BBB
 * plugin auto-provisions the channel's BbbOrganization with
 * slug === TenantProfile.tenantSlug.
 *
 * This makes BbbOrganization.slug a synchronized projection of the tenant
 * slug (never an independent identity source), so the marketplace academySlug
 * and the platform hostname `{tenantSlug}.saa9vi.com` to remain synchronized
 * (asynchronous/eventual consistency — the listener reconciles slug FROM
 * TenantProfile.tenantSlug).
 *
 * Idempotent for repeated sequential delivery: creation is skipped if an org
 * already exists for the channel (BbbOrganizationService.create throws on an
 * existing channel org). Concurrent duplicate delivery is NOT proven safe by
 * the service alone — it relies on BbbOrganization's unique channelId column
 * index as the database guard (a concurrent second create would surface as a
 * unique violation and be logged, not thrown to the caller).
 *
 * ADR-047 Phase 3 (S3): the same listener seeds the plugin's `defaultRooms`
 * (default `["Main Classroom"]`) for the organization it just created, through
 * `BbbRoomService.create` on the same channel-scoped ctx — so a new tenant
 * lands in a usable academy. Seeding is guarded by a zero-room check
 * (`seedDefaultRooms`) and never fails organization provisioning.
 */
@Injectable()
export class BbbTenantProvisioningListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBus,
    private readonly connection: TransactionalConnection,
    private readonly requestContextService: RequestContextService,
    private readonly bbbOrganizationService: BbbOrganizationService,
    private readonly bbbRoomService: BbbRoomService,
    @Inject(BBB_PLUGIN_OPTIONS)
    private readonly options: BigBlueButtonPluginOptions,
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

        const org = await this.bbbOrganizationService.create(orgCtx, {
          channelId: event.channelId,
          tenantProfileId: event.tenantProfileId,
          name: event.businessName,
          slug: event.tenantSlug,
        });
        Logger.info(
          `TenantRegisteredEvent: provisioned BbbOrganization (slug="${event.tenantSlug}") for channel ${event.channelId}`,
          loggerCtx,
        );

        // ADR-047 Phase 3: the tenant lands with its default rooms, so a fresh
        // academy is usable before any manual setup. Idempotent + non-throwing
        // (see seedDefaultRooms) — organization provisioning stays the contract.
        await this.seedDefaultRooms(orgCtx, org);
      } catch (e: any) {
        Logger.error(
          `TenantRegisteredEvent: BbbOrganization provisioning failed for channel ${event.channelId}: ${e?.message}`,
          loggerCtx,
        );
      }
    });
  }

  /**
   * Configured default room names (ADR-047 Phase 3).
   *
   * `undefined` → `DEFAULT_SEEDED_ROOM_NAMES`; an explicit `[]` is honoured as
   * "seed nothing" (a deliberate opt-out — the same configured-vs-omitted
   * distinction `defaultRatePaisePerLearnerHour` uses).
   */
  private get defaultRoomNames(): readonly string[] {
    return this.options.defaultRooms ?? DEFAULT_SEEDED_ROOM_NAMES;
  }

  /**
   * ADR-047 Phase 3 — seed the organization's default rooms.
   *
   * Runs through `BbbRoomService.create()` so the seeded rooms behave exactly
   * like hand-created ones: ADR-031 capacity clamping (org value, or the
   * effective platform policy), `recordingEnabled` inherited from the
   * organization, `state: 'Idle'`. No slug is set: rooms are
   * organization-scoped, and `BbbRoom.slug` is globally unique — a shared slug
   * would collide across tenants (A8/D5).
   *
   * Idempotency is structural, not bookkeeping: seeding happens only while the
   * organization has ZERO rooms, so a re-delivered `TenantRegisteredEvent` — or
   * a retry after a partially-applied seed — can never duplicate rooms. (A
   * re-delivery for an org that already exists returns earlier, at the
   * existing-organization check; this guard additionally covers an org created
   * by any other path.)
   *
   * Failures are logged, never thrown: the listener's contract is organization
   * provisioning, and a tenant without default rooms can still create them.
   */
  private async seedDefaultRooms(
    ctx: RequestContext,
    org: BbbOrganization,
  ): Promise<void> {
    try {
      const names = this.defaultRoomNames
        .map((name) => (typeof name === "string" ? name.trim() : ""))
        .filter((name) => name.length > 0);
      if (names.length === 0) {
        Logger.debug(
          `TenantRegisteredEvent: no default rooms configured; org ${org.id} seeded with zero rooms`,
          loggerCtx,
        );
        return;
      }

      const existingRoomCount = await this.connection
        .getRepository(ctx, BbbRoom)
        .count({ where: { organization: { id: org.id } } });
      if (existingRoomCount > 0) {
        Logger.debug(
          `TenantRegisteredEvent: org ${org.id} already has ${existingRoomCount} room(s); default rooms not seeded`,
          loggerCtx,
        );
        return;
      }

      for (const name of names) {
        const room = await this.bbbRoomService.create(ctx, {
          organizationId: org.id,
          name,
        });
        Logger.info(
          `TenantRegisteredEvent: seeded default room "${room.name}" (id=${room.id}) for org ${org.id}`,
          loggerCtx,
        );
      }
    } catch (e: any) {
      Logger.error(
        `TenantRegisteredEvent: seeding default rooms failed for org ${org.id}: ${e?.message}`,
        loggerCtx,
      );
    }
  }
}
