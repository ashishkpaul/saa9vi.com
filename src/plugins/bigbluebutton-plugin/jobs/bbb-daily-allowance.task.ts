import { ScheduledTask } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { BbbDailyAllowanceService } from "../services/bbb-daily-allowance.service";

const loggerCtx = "BbbDailyAllowanceTask";

/**
 * Slice 6 / D-7 — daily-allowance refresh.
 *
 * ── Schedule ─────────────────────────────────────────────────────────────────
 * Hourly. The grant is for a whole server day, so the only things the schedule
 * has to guarantee are (a) that the day's grant exists soon after the boundary
 * and (b) that it still gets created after downtime. Hourly satisfies both, and
 * because the underlying write is idempotent (per-key advisory lock +
 * `(organization, validFrom = startOfDay, sourceType)` existence check) an extra
 * run is free — no `every(1).minute()` precision is needed to be correct.
 * `cron.every(1).hours()` is the same expression `subscription-dunning.task.ts`
 * already uses, so the scheduler options stay uniform.
 *
 * ── Timezone ─────────────────────────────────────────────────────────────────
 * The Saa9vi server clock (ADR-042's rule, reused by D-7) — see
 * `dailyAllowanceWindowFor()`. There is no per-tenant timezone and no cron
 * timezone configuration: the boundary the tenant is measured against is the
 * boundary the platform enforces, computed from the same clock at read time.
 *
 * ── Catch-up after downtime ──────────────────────────────────────────────────
 * The first run after a rollover materialises the current day's grant, which is
 * the whole catch-up obligation — a window that has already closed cannot be
 * consumed, so re-creating a missed past day would only inflate reported
 * `includedMinutes` for capacity nobody can use. Nothing is backfilled.
 *
 * Failure handling: the sweep never throws. It returns counts (and logs), so a
 * single unreachable tenant cannot abort the sweep or trip the scheduler.
 */
export const bbbDailyAllowanceTask = new ScheduledTask({
  id: "bbb-daily-allowance",
  description:
    "Materialise the current server-day live allowance grant for daily-only (provider-free) plans",
  schedule: (cron) => cron.every(1).hours(),
  async execute({ injector }) {
    const allowanceService = injector.get(BbbDailyAllowanceService);
    const { scanned, created, existing, failed } =
      await allowanceService.refreshDailyAllowance();

    if (created > 0 || failed > 0) {
      Logger.log(
        `Daily allowance refreshed: scanned=${scanned} created=${created} existing=${existing} failed=${failed}`,
        loggerCtx,
      );
    }

    return { scanned, created, existing, failed };
  },
});
