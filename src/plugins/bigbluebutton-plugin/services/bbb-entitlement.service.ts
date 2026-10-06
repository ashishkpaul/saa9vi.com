import { Injectable, Logger } from "@nestjs/common";
import {
  ForbiddenError,
  ID,
  Permission,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";
import { IsNull } from "typeorm";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
import {
  anyEntitlementRowLive,
  isEntitlementRowUnexpired,
} from "../entities/bbb-entitlement.entity";
import type {
  EntitlementType,
  EntitlementSource,
} from "../entities/bbb-entitlement.entity";
import { BbbChannelAccessService } from "./bbb-channel-access.service";

const loggerCtx = "BbbEntitlementService";

export interface CreateEntitlementInput {
  type: EntitlementType;
  resourceId: string;
  customerId: ID;
  source: EntitlementSource;
  validFrom?: Date | null;
  validUntil?: Date | null;
  channelId?: string | null;
}

/**
 * Manages access entitlements for BBB resources (sessions, rooms).
 *
 * This is the ADR-targeted access primitive. Currently handles:
 * - "bbb_session": scheduled session access (purchased or trial)
 * - "bbb_room": (future) room access
 *
 * Key design decisions (W5 follow-up 2/5 — widened duplicate-row spec):
 * - The natural key (channel, customer, type, resourceId) may hold MULTIPLE
 *   rows (history from the pre-fix non-idempotent create). Readers use
 *   ANY-live; writers are keyed on ALL rows of the key, never findOne-then-
 *   decide.
 * - `create` is a locked grant: per-key `pg_advisory_xact_lock`, then return
 *   an unexpired row if one exists, else INSERT a NEW row. Revoked rows are
 *   kept as history and are NEVER reactivated (their stamps stay answerable).
 * - `delete` is revoke-as-deactivate: a single UPDATE expires every unexpired
 *   row of the key with first-writer-wins audit stamps.
 * - No admin UI yet. No expiry cron job yet. Those come in later phases.
 */
@Injectable()
export class BbbEntitlementService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly channelAccess: BbbChannelAccessService,
  ) {}

  /**
   * Creates an entitlement under a per-key advisory lock (see class doc).
   *
   * Idempotent on the ACTIVE state: a concurrent or repeated call for the
   * same key converges on one unexpired row instead of racing a read-then-
   * insert into duplicate natural-key rows (the root cause of the duplicate
   * history this whole follow-up exists for).
   */
  async create(
    ctx: RequestContext,
    input: CreateEntitlementInput,
  ): Promise<BbbEntitlement> {
    // Enforce channel isolation: a non-SuperAdmin may only create an
    // entitlement for the channel they are operating under.
    //
    // Compare as strings: `ctx.channelId` arrives as a number under the
    // increment id strategy (the default), while `input.channelId` comes from
    // a varchar column (`BbbScheduledSession.channelId`, `BbbRoom`'s org) and
    // is therefore a string. A strict `!==` compared "2" against 2 and refused
    // every legitimate tenant-admin creation — e.g. convertTrialToEnrollment,
    // whose only ForbiddenError source is this check. Mirrors the
    // `String(a) !== String(b)` coercion in BbbChannelAccessService.
    if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
      const channelId = ctx.channelId as string;
      if (input.channelId && String(input.channelId) !== String(channelId)) {
        throw new ForbiddenError();
      }
    }

    const customerId = String(input.customerId);
    const channelId = input.channelId ?? null;
    const where = {
      customerId,
      type: input.type,
      resourceId: input.resourceId,
      // null = legacy unscoped rows: FindWhereOptions needs IsNull() (a bare
      // `null` is not assignable) — `channelId IS NULL` matches them.
      channelId: channelId == null ? IsNull() : channelId,
    };
    // Advisory lock key = the natural key, channel first. Transaction-scoped:
    // released on COMMIT/ROLLBACK so it cannot leak across a failed grant.
    const lockKey = `bbb_entitlement:${channelId ?? "null"}:${customerId}:${input.type}:${input.resourceId}`;

    // Own transaction even when the caller already runs one (the admin
    // resolver is @Transaction()-decorated): the lock must span the
    // read-then-insert below, and a lock taken on an auto-commit statement
    // would release before the insert. The resolver performs only reads
    // before delegating, so committing the grant on its own connection is
    // atomic for this operation and cannot deadlock the caller.
    return this.connection.rawConnection.transaction(async (em) => {
      await em.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        lockKey,
      ]);

      const now = new Date();
      const rows = await em.getRepository(BbbEntitlement).find({ where });
      const existing = rows.find((r) => isEntitlementRowUnexpired(r, now));
      if (existing) {
        Logger.debug(
          `Entitlement already live for customer=${customerId} type=${input.type} resource=${input.resourceId} — returning row ${existing.id}`,
          loggerCtx,
        );
        return existing;
      }

      // No active row (first grant, or history is all expired/revoked):
      // INSERT NEW — never reactivate, the old rows keep their stamps.
      const entitlement = new BbbEntitlement({
        type: input.type,
        resourceId: input.resourceId,
        customerId,
        source: input.source,
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        channelId,
      });

      const saved = await em.getRepository(BbbEntitlement).save(entitlement);

      Logger.log(
        `Entitlement created: customer=${saved.customerId} type=${saved.type} resource=${saved.resourceId} source=${saved.source}`,
        loggerCtx,
      );

      return saved;
    });
  }

  /**
   * Checks if a customer has valid (non-expired, started) access.
   *
   * ANY-live over ALL rows for the key: history can hold duplicates on the
   * natural key, so a single findOne is order-dependent — access holds iff at
   * least one row is started and unexpired (shared isEntitlementRowLive).
   */
  async hasAccess(
    ctx: RequestContext,
    customerId: ID,
    type: EntitlementType,
    resourceId: string,
  ): Promise<boolean> {
    const channelId = ctx.channelId as string;
    const rows = await this.connection
      .getRepository(ctx, BbbEntitlement)
      .find({
        where: {
          customerId: String(customerId),
          type,
          resourceId,
          channelId,
        },
      });

    return anyEntitlementRowLive(rows);
  }

  /**
   * Deactivates access (revocation or manual override).
   *
   * A SINGLE UPDATE expires EVERY unexpired row for the natural key — a live
   * duplicate would otherwise keep access after a "successful" revoke, a
   * silent failure. Stamps are first-writer-wins via CASE: rows already
   * stamped keep their original revoker (their expiry is untouched too).
   */
  async delete(
    ctx: RequestContext,
    customerId: ID,
    type: EntitlementType,
    resourceId: string,
  ): Promise<void> {
    const channelId = ctx.channelId as string;
    const requesterId =
      ctx.activeUserId != null ? String(ctx.activeUserId) : null;
    const now = new Date();
    const repo = this.connection.getRepository(ctx, BbbEntitlement);
    // Schema-qualify (repo.metadata.tablePath): TypeORM only rewrites
    // METADATA-based queries — a bare `bbb_entitlement` in raw SQL resolves
    // through search_path (public in the e2e suites) and would silently
    // update 0 rows in the configured test schema.
    await repo.manager.query(
      `UPDATE ${repo.metadata.tablePath}
          SET "validUntil" = $1,
              "deactivatedAt" = CASE WHEN "deactivatedAt" IS NULL THEN $1 ELSE "deactivatedAt" END,
              "deactivatedByUserId" = CASE WHEN "deactivatedByUserId" IS NULL THEN $2 ELSE "deactivatedByUserId" END
        WHERE "channelId" = $3
          AND "customerId" = $4
          AND "type" = $5
          AND "resourceId" = $6
          AND ("validUntil" IS NULL OR "validUntil" > $1)`,
      [now, requesterId, channelId, String(customerId), type, resourceId],
    );
  }
}
