import { Injectable } from "@nestjs/common";
import { Logger, TransactionalConnection } from "@vendure/core";
import { In } from "typeorm";

import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import {
  DAILY_ALLOWANCE_MINUTES,
  DAILY_ALLOWANCE_SOURCE_TYPE,
  dailyAllowanceIdempotencyKey,
  dailyAllowanceWindowFor,
  isDailyOnlyPlan,
} from "./daily-allowance.policy";

const loggerCtx = "BbbDailyAllowanceService";

/** Outcome of one sweep. Counts only — no entity is returned to a scheduler. */
export interface DailyAllowanceRefreshResult {
  /** Channels on a daily-only (provider-free) plan, i.e. eligible for a daily grant. */
  scanned: number;
  /** Grants written by this sweep. */
  created: number;
  /** Grants that already existed for the current day — the idempotent no-op path. */
  existing: number;
  /** Channels where the sweep could not complete (org missing, write error). */
  failed: number;
}

/** Shape of the raw subscription/plan join this service reads. */
interface DailyOnlySubscriptionRow {
  channelId: string;
  planId: string;
  providerPlanId: string | null;
}

/**
 * Slice 6 — the ONE writer of daily live-allowance grants (ADR-045, INV-026).
 *
 * ── What this service owns ───────────────────────────────────────────────────
 * Exactly one thing: materialising "today's 60 live minutes" for channels whose
 * plan is provider-free (`isDailyOnlyPlan`). Plan §3.3 forbids a second writer
 * on the `(organization, validFrom = startOfDay, sourceType = 'subscription')`
 * key, so both triggers — the hourly scheduled sweep and the plan-changed
 * consumer — call `ensureDailyGrantForChannel()` here rather than writing grants
 * themselves. Triggers are plural; the writer is singular.
 *
 * ── What this service deliberately does NOT do ───────────────────────────────
 * • It does not touch the debit path. Consumption stays in
 *   `BbbReconciliationService.consumeGrantHours()` — ledger insert plus the CAS
 *   increment — and `BbbUsageLedger` semantics are unchanged. A daily grant is
 *   billed by exactly the same code as an order or period grant, because
 *   selection and consumption are keyed on `sourceType`, never on a "kind of day".
 * • It does not create billing-period grants. Provider-free plans never receive
 *   `SubscriptionRenewedEvent`, and D-8 fixes the free tier to daily **only**
 *   (§3.6: the free billing-period row is `—`).
 * • It does not enforce anything. Enforcement is already correct and shared:
 *   `BbbProvisioningWorkerService.doProvisionMeeting()` selects from
 *   tenant-selectable, non-exhausted, in-window grants and fails closed with
 *   `grantUnavailableReason(...)`. A daily grant is simply an in-window
 *   `subscription` grant, so the existing gate serves it with no change.
 *
 * ── Read model ───────────────────────────────────────────────────────────────
 * `SubscriptionShopService.findMyLiveUsage()` already sums in-window,
 * tenant-selectable, non-unbounded grants from the same table. Daily grants are
 * therefore reported with **no schema, SDL or codegen change** — exactly the
 * contract slice 8 froze ("slice 6's daily allowance will populate these same
 * fields", `subscription-shop.service.ts:137-140`).
 *
 * ── Why raw SQL for the subscription lookup ──────────────────────────────────
 * BigBlueButtonPlugin must not depend on the subscription plugin's entities (the
 * dependency direction in this codebase is subscription → bbb, never the
 * reverse; see `subscription-shop.service.ts`). `BbbPlatformCapacityPolicyService`
 * established the supported alternative for Tier 2: a schema-qualified raw
 * lookup. The qualification is not cosmetic — TypeORM qualifies entity tables
 * with the connection's `schema`, while a raw string resolves through
 * `search_path`, so an unqualified query silently reads the wrong schema in every
 * schema-isolated e2e run. This module repeats that rule for the same reason.
 */
@Injectable()
export class BbbDailyAllowanceService {
  constructor(private readonly connection: TransactionalConnection) {}

  /**
   * Schema-qualified subscription table reference (Tier-2 precedent —
   * `BbbPlatformCapacityPolicyService.subscriptionTableRef`).
   */
  private get subscriptionTableRef(): string {
    const schema = (
      this.connection.rawConnection.options as { schema?: string }
    ).schema;
    return schema
      ? `"${schema}"."organization_subscription"`
      : `"organization_subscription"`;
  }

  /** Schema-qualified plan table reference — same qualification rule. */
  private get planTableRef(): string {
    const schema = (
      this.connection.rawConnection.options as { schema?: string }
    ).schema;
    return schema ? `"${schema}"."subscription_plan"` : `"subscription_plan"`;
  }

  /**
   * Scheduled entry point (D-7).
   *
   * Idempotent and re-entrant: it writes today's grant if it is missing and does
   * nothing if it already exists, so the sweep may run as often as the schedule
   * likes without ever granting a second allowance. That property is also the
   * catch-up mechanism — the first run after a day rollover (or after a restart
   * that missed the rollover) materialises the current day's grant. There is
   * nothing to backfill for a skipped past day: an allowance whose window has
   * already closed cannot be consumed, so re-creating it would only inflate
   * `includedMinutes` for a period nobody can use.
   *
   * `now` is injectable so the window logic is testable without freezing time.
   */
  async refreshDailyAllowance(
    now: Date = new Date(),
  ): Promise<DailyAllowanceRefreshResult> {
    const result: DailyAllowanceRefreshResult = {
      scanned: 0,
      created: 0,
      existing: 0,
      failed: 0,
    };

    const subscriptions = await this.findDailyOnlySubscriptions();
    if (subscriptions.length === 0) {
      return result;
    }

    const channels = subscriptions.map((row) => row.channelId);
    const organizations = await this.connection.rawConnection
      .getRepository(BbbOrganization)
      .find({ where: { channelId: In(channels) } });
    const orgByChannel = new Map(
      organizations.map((org) => [String(org.channelId), org]),
    );

    for (const row of subscriptions) {
      result.scanned++;
      const org = orgByChannel.get(String(row.channelId));
      if (!org) {
        // A subscription without an organisation is a real provisioning gap
        // (the two plugins provision independently), so it is counted rather
        // than swallowed. The next sweep retries.
        result.failed++;
        Logger.warn(
          `Daily allowance skipped: no BbbOrganization for channel ${row.channelId} ` +
            `(plan ${row.planId}). Provisioning gap — will retry on the next sweep.`,
          loggerCtx,
        );
        continue;
      }

      try {
        const created = await this.ensureDailyGrantForOrganization(
          String(org.id),
          now,
          "scheduled-sweep",
        );
        if (created) {
          result.created++;
        } else {
          result.existing++;
        }
      } catch (err: any) {
        result.failed++;
        Logger.error(
          `Daily allowance failed for channel ${row.channelId} ` +
            `(org ${org.id}, plan ${row.planId}): ${err?.message ?? err}`,
          loggerCtx,
        );
      }
    }

    if (result.created > 0 || result.failed > 0) {
      Logger.info(
        `Daily allowance sweep: scanned=${result.scanned} created=${result.created} ` +
          `existing=${result.existing} failed=${result.failed}`,
        loggerCtx,
      );
    }
    return result;
  }

  /**
   * Single-channel entry point for the event path (a plan was established or
   * changed). Returns today's grant — newly written, or the one already there —
   * and `null` whenever the channel is not on a daily-only plan.
   *
   * Returning `null` is a normal outcome, never an error:
   *   • no subscription yet → nothing to allow (the hourly sweep retries);
   *   • provider-backed plan → the billing-period pool owns the allowance, so
   *     writing a daily grant here would hand a paid tenant capacity the
   *     commercial matrix does not sell (§3.6: paid daily row is `—`).
   */
  async ensureDailyGrantForChannel(
    channelId: string | number,
    trigger: string,
    now: Date = new Date(),
  ): Promise<BbbCapacityGrant | null> {
    const subscription = await this.findSubscriptionForChannel(channelId);
    if (!subscription) {
      return null;
    }

    if (!isDailyOnlyPlan(subscription)) {
      // Paid tier: no daily grant, by design. Logged at debug because this is
      // the expected branch on a free → paid plan change.
      Logger.debug(
        `No daily grant for channel ${channelId}: plan ${subscription.planId} is ` +
          `provider-backed, so its allowance is the billing-period pool (trigger=${trigger}).`,
        loggerCtx,
      );
      return null;
    }

    const org = await this.connection.rawConnection
      .getRepository(BbbOrganization)
      .findOne({ where: { channelId: String(channelId) } });
    if (!org) {
      // Registration ordering is not guaranteed between the two plugins, so this
      // is expected in the window before BbbOrganization exists. The scheduled
      // sweep heals it — the same eventual-convergence contract ADR-031
      // Decision 5 established for plan-derived capacity.
      Logger.warn(
        `No daily grant for channel ${channelId}: no BbbOrganization found ` +
          `(trigger=${trigger}). The scheduled sweep will retry.`,
        loggerCtx,
      );
      return null;
    }

    return this.ensureDailyGrantForOrganization(String(org.id), now, trigger);
  }

  /**
   * Idempotent write of one organization's grant for the day containing `now`.
   *
   * Race safety: the read-then-insert pair runs in one transaction holding a
   * **per-key PostgreSQL advisory lock** derived from
   * `dailyAllowanceIdempotencyKey()`. Without it, the plan-changed consumer and
   * the scheduled sweep could both miss the same `findOne()` and insert two
   * grants for one day — a 120-minute allowance for a 60-minute day, invisible
   * to both callers. INV-025 established the advisory-lock-over-version-
   * allocation pattern in this codebase; this reuses it rather than adding DDL,
   * because slice 6 must not change the frozen schema. A partial unique index on
   * `(organizationId, validFrom, sourceType) WHERE sourceType = 'subscription'`
   * would make the same rule structural at the database level and is recorded in
   * ADR-045 as the deliberate deferral.
   *
   * Returns the created grant, or `null` when today's grant already existed.
   */
  private async ensureDailyGrantForOrganization(
    organizationId: string,
    now: Date,
    trigger: string,
  ): Promise<BbbCapacityGrant | null> {
    const window = dailyAllowanceWindowFor(now);
    const key = dailyAllowanceIdempotencyKey(organizationId, window);

    return this.connection.rawConnection.transaction(async (em) => {
      // Transaction-scoped, so it is released on commit/rollback and cannot leak
      // across a failed sweep.
      await em.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        key,
      ]);

      const repo = em.getRepository(BbbCapacityGrant);
      const existing = await repo.findOne({
        where: {
          organization: { id: organizationId },
          // Exact match is safe: `startOfServerDay()` zeroes H/M/S/ms, so the
          // stored timestamp and this Date agree to the millisecond. This is the
          // same key shape — and the same Date-as-parameter behaviour — the
          // renewal writer's BUG-032 dedupe already relies on.
          validFrom: window.start,
          sourceType: DAILY_ALLOWANCE_SOURCE_TYPE,
        },
      });
      if (existing) {
        return null;
      }

      const grant = new BbbCapacityGrant({
        organization: { id: organizationId } as BbbOrganization,
        // Not order-linked: a daily allowance has no order line behind it.
        orderId: null,
        orderLineId: null,
        productVariantId: null,
        grantedMinutes: DAILY_ALLOWANCE_MINUTES,
        consumedMinutes: 0,
        validFrom: window.start,
        validUntil: window.end,
        exhausted: false,
        sourceType: DAILY_ALLOWANCE_SOURCE_TYPE,
        // A daily 60 is a real, exhaustible quantity — never the overhead sentinel.
        isUnbounded: false,
      });

      const saved = await repo.save(grant);
      Logger.info(
        `Created daily allowance grant: org=${organizationId} grantId=${saved.id} ` +
          `minutes=${DAILY_ALLOWANCE_MINUTES} validUntil=${window.end.toISOString()} ` +
          `(trigger=${trigger})`,
        loggerCtx,
      );
      return saved;
    });
  }

  /**
   * Every channel on a daily-only plan, read from the subscription table itself.
   *
   * `status IN ('trialing','active')` deliberately mirrors Tier 2's predicate in
   * `BbbPlatformCapacityPolicyService`, so "which plan is in force for this
   * channel" has exactly one definition across plan-derived capacity and the
   * daily allowance. `past_due` is a paid-only state and is excluded along with
   * the paid tier's allowance shape.
   */
  private async findDailyOnlySubscriptions(): Promise<
    DailyOnlySubscriptionRow[]
  > {
    const rows: DailyOnlySubscriptionRow[] =
      await this.connection.rawConnection.query(
        `SELECT s."channelId" AS "channelId",
                s."planId"    AS "planId",
                p."providerPlanId" AS "providerPlanId"
           FROM ${this.subscriptionTableRef} s
           JOIN ${this.planTableRef} p ON p."id" = s."planId"
          WHERE s."status" IN ('trialing', 'active')
            AND p."providerPlanId" IS NULL`,
      );
    return rows ?? [];
  }

  /** The channel's in-force subscription row, or null when it has none. */
  private async findSubscriptionForChannel(
    channelId: string | number,
  ): Promise<DailyOnlySubscriptionRow | null> {
    const rows: DailyOnlySubscriptionRow[] =
      await this.connection.rawConnection.query(
        `SELECT s."channelId" AS "channelId",
                s."planId"    AS "planId",
                p."providerPlanId" AS "providerPlanId"
           FROM ${this.subscriptionTableRef} s
           JOIN ${this.planTableRef} p ON p."id" = s."planId"
          WHERE s."channelId" = $1
            AND s."status" IN ('trialing', 'active')
          ORDER BY s."updatedAt" DESC
          LIMIT 1`,
        [String(channelId)],
      );
    return rows?.[0] ?? null;
  }
}
