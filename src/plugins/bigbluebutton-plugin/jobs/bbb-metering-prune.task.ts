import { ScheduledTask } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { BbbMeteringService } from "../services/bbb-metering.service";

const loggerCtx = "BbbMeteringPruneTask";

/**
 * ADR-047 Phase 2B / plan item 8 — metered sample retention.
 *
 * Samples are **operational, not billing facts** (INV-028): once a meeting's
 * `BbbMeteredUsage` row is frozen, the per-minute rows that produced it have no
 * further reader, so they are pruned to keep the table (and its backups)
 * bounded.
 *
 * ── Schedule ────────────────────────────────────────────────────────────────
 * Daily at 03:30. The retention boundary is 35 days, so any cadence of once a
 * day or faster is equivalent for correctness — daily keeps the unindexed
 * `bucketMinute < cutoff` sweep (a full scan by nature) off the 5-minute
 * reconciliation tick, which runs every 5 minutes for far more urgent reasons.
 * `cron.every(1).days(3, 30)` mirrors the `every(n).hours()` form the other
 * task files use, so the scheduler options stay uniform.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 * The DELETE is scoped to meetings that can no longer be billed (never `Active`
 * / `Provisioning`, and never a `Completed` metered meeting that has no usage
 * row yet — those samples ARE the bill). Re-running it deletes nothing extra,
 * so a duplicate registration or a catch-up run after downtime is harmless.
 * Failure is isolated: a bad sweep is logged and returns 0 rather than tripping
 * the scheduler.
 */
export const bbbMeteringPruneTask = new ScheduledTask({
  id: "bbb-metering-prune",
  description:
    "Prune metered per-minute meeting samples past their 35-day retention window",
  schedule: (cron) => cron.every(1).days(3, 30),
  async execute({ injector }) {
    const meteringService = injector.get(BbbMeteringService);
    try {
      const pruned = await meteringService.pruneSamples();
      if (pruned > 0) {
        Logger.log(`Pruned ${pruned} metered meeting sample(s)`, loggerCtx);
      }
      return { pruned };
    } catch (err) {
      Logger.error(
        `Metered sample prune failed: ${(err as Error).message}`,
        loggerCtx,
        (err as Error).stack,
      );
      return { pruned: 0 };
    }
  },
});
