import { Inject, Injectable } from "@nestjs/common";
import { EventBus, Logger, RequestContext, TransactionalConnection } from "@vendure/core";
import { EntityManager } from "typeorm";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbUsageLedger } from "../entities/bbb-usage-ledger.entity";
import { GrantReaderService } from "./grant-reader.service";
import { GrantConsumedEvent } from "../events/bbb-events";
import { BBB_PLUGIN_OPTIONS } from "../constants";
import type { BigBlueButtonPluginOptions } from "../types";

const loggerCtx = "GrantConsumptionService";

/**
 * S7A (Phase 7.3) — the grant billing boundary.
 *
 * Owns the entire economic grant operation previously embedded in
 * BbbReconciliationService.consumeGrantHours(): fair-billing threshold,
 * duration/cap math, GrantReaderService resolution, the idempotent
 * `INSERT … ON CONFLICT DO NOTHING` ledger row (INV-002 — the database
 * insert IS the idempotency decision), the atomic CAS grant update,
 * the internal-overhead branch, and GrantConsumedEvent publication.
 *
 * Extracted so BbbMeetingService (via the lifecycle path) and
 * BbbReconciliationService (pending-billing recovery) both depend on this
 * boundary instead of forming the meeting ↔ reconciliation import cycle.
 * The method body is a mechanical relocation — no behavioral change.
 */
@Injectable()
export class GrantConsumptionService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly grantReader: GrantReaderService,
    private readonly eventBus: EventBus,
    @Inject(BBB_PLUGIN_OPTIONS)
    private readonly options: BigBlueButtonPluginOptions,
  ) {}

  /** Minimum meeting duration (ms) before billing is applied */
  private get fairBillingMinDurationMs(): number {
    return this.options.fairBillingMinDurationMs ?? 120_000; // 2 min
  }

  /** Maximum meeting duration (ms) before billing is capped */
  private get maxMeetingDurationMs(): number {
    return this.options.maxMeetingDurationMs ?? 24 * 60 * 60 * 1000; // 24 hours
  }

  async consumeGrantHours(
    ctx: RequestContext,
    meeting: BbbMeeting,
  ): Promise<void> {
    if (!meeting.provisionedAt) {
      Logger.warn(
        `Meeting ${meeting.id} has no provisionedAt — cannot bill consumption`,
        loggerCtx,
      );
      return;
    }

    if (!meeting.grantId) {
      Logger.warn(
        `Meeting ${meeting.id} has no grantId stored — was it provisioned before the grantId column existed?`,
        loggerCtx,
      );
      return;
    }

    const provisionedAt = meeting.provisionedAt;
    const endedAt = meeting.completedAt ?? new Date();
    const durationMs = endedAt.getTime() - provisionedAt.getTime();

    // Fair billing: a meeting shorter than the threshold bills ZERO minutes.
    //
    // It still writes an immutable ledger row — that row is exactly what tells
    // `reconcilePendingBilling` "this meeting has been accounted for". Before
    // this, the early return left the row absent forever, so the recovery scan
    // re-visited the same sub-threshold meeting on EVERY pass and re-published
    // MeetingCompletedEvent each time.
    //
    // INV-002 is untouched: the row is still inserted with
    // INSERT … ON CONFLICT (meeting, grant) DO NOTHING, so replay stays
    // idempotent — it just inserts 0 minutes instead of nothing.
    const subThreshold = durationMs < this.fairBillingMinDurationMs;
    if (subThreshold) {
      Logger.info(
        `Meeting ${meeting.id} lasted less than fair billing threshold (${Math.round(durationMs / 1000)}s). Billing 0 minutes — the ledger row still records the fact.`,
        loggerCtx,
      );
    }

    // Billing ceiling: cap duration if the meeting was force-completed.
    const effectiveDurationMs = meeting.billingCapped
      ? Math.min(durationMs, this.maxMeetingDurationMs)
      : durationMs;

    // Round up to nearest minute; minimum 1 minute — EXCEPT a sub-threshold
    // meeting, which bills exactly 0.
    const durationMinutes = subThreshold
      ? 0
      : Math.max(1, Math.ceil(effectiveDurationMs / (1000 * 60)));

    // Resolve grant via GrantReaderService (RFC-001 Q-009 seam)
    const grantEntity = await this.grantReader.resolveEntityForMeeting(
      meeting.grantId as string,
    );

    if (!grantEntity) {
      Logger.warn(
        `Meeting ${meeting.id}: stored grantId ${meeting.grantId} not found`,
        loggerCtx,
      );
      return;
    }

    const sourceType = grantEntity.sourceType;

    // Transactional: ledger + grant update must succeed or fail together.
    // IDEMPOTENCY (INV-002): the database INSERT itself is the idempotency
    // decision — INSERT ... ON CONFLICT (meetingId, grantId) DO NOTHING
    // (via .orIgnore()) + RETURNING tells us whether this worker won the
    // right to bill. Check-then-insert is prohibited: two concurrent workers
    // could both pass a findOne() guard and race past it.
    let billingWon = false;
    let committed: {
      consumedMinutes: number;
      grantedMinutes: number;
      exhausted: boolean;
    } | null = null;

    await this.connection.rawConnection.transaction(
      async (em: EntityManager) => {
        const insertResult = await em
          .createQueryBuilder()
          .insert()
          .into(BbbUsageLedger)
          .values({
            meeting: { id: meeting.id as any },
            grant: { id: grantEntity.id as any },
            consumedMinutes: durationMinutes,
            startedAt: provisionedAt,
            completedAt: endedAt,
          })
          .orIgnore()
          .returning("id")
          .execute();

        if (!insertResult.raw?.length) {
          // Lost the insert race: another worker already billed this
          // (meeting, grant) pair. No economic side effect is allowed.
          Logger.warn(
            `Meeting ${meeting.id}: billing ledger row already exists (insert-on-conflict lost race). Skipping duplicate.`,
            loggerCtx,
          );
          return;
        }
        billingWon = true;

        // Sub-threshold (0 minutes): the ledger row is the whole story. No
        // grant movement for a meeting that consumed nothing — a CAS on
        // `consumedMinutes + 0` would be pointless churn on a grant we
        // deliberately did not change, and could only flip `exhausted` around
        // an already-true value.
        if (durationMinutes === 0) {
          return;
        }

        // internal_overhead grants: write ledger row only, skip exhaustion logic
        if (sourceType === "internal_overhead") {
          return;
        }

        // Atomic increment on minutes columns; RETURNING gives the committed
        // post-increment values so downstream events never see stale data.
        const updateResult = await em
          .getRepository(BbbCapacityGrant)
          .createQueryBuilder()
          .update()
          .set({
            consumedMinutes: () => `"consumedMinutes" + :increment`,
            exhausted: () =>
              `CASE WHEN ("consumedMinutes" + :increment) >= "grantedMinutes" THEN TRUE ELSE FALSE END`,
          })
          .where("id = :id", { id: grantEntity.id as string })
          .setParameters({ increment: durationMinutes })
          .returning(["consumedMinutes", "grantedMinutes", "exhausted"])
          .execute();

        const row = (updateResult.raw?.[0] ?? {}) as Record<string, any>;
        committed = {
          consumedMinutes: Number(row.consumedMinutes ?? 0),
          grantedMinutes: Number(row.grantedMinutes ?? 0),
          exhausted: Boolean(row.exhausted),
        };
      },
    );

    if (!billingWon) {
      return;
    }

    // Sub-threshold: the immutable row exists and the grant did not move, so
    // there is nothing for a consumer to react to — GrantConsumedEvent would
    // only report "0 minutes consumed" noise to quota listeners.
    if (durationMinutes === 0) {
      Logger.info(
        `Billed meeting ${meeting.id}: 0 min (below fair-billing threshold) — ledger row written, grant untouched`,
        loggerCtx,
      );
      return;
    }

    const committedState = committed as {
      consumedMinutes: number;
      grantedMinutes: number;
      exhausted: boolean;
    } | null;
    const committedConsumed =
      committedState?.consumedMinutes ?? grantEntity.consumedMinutes + durationMinutes;
    const committedGranted = committedState?.grantedMinutes ?? grantEntity.grantedMinutes;
    Logger.info(
      `Billed meeting ${meeting.id}: ${durationMinutes}min consumed${meeting.billingCapped ? " (CAPPED)" : ""} (${committedConsumed}/${committedGranted}min)`,
      loggerCtx,
    );

    // internal_overhead grants don't participate in quota alerts
    if (sourceType === "internal_overhead") {
      return;
    }

    const remainingMinutes = committedGranted - committedConsumed;
    this.eventBus.publish(
      new GrantConsumedEvent(
        grantEntity.id as string,
        meeting.id as string,
        (grantEntity.organization?.id as string) ?? "",
        durationMinutes,
        Math.max(0, remainingMinutes),
      ),
    );
  }
}