import { ScheduledTask } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { BbbServerService } from "../services/bbb-server.service";

const loggerCtx = "BbbServerHealthTask";

/**
 * Signed per-server health probe (Track A item 1, 2026-10-07).
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Before this task NO health job existed (jobs/ held only reconciliation,
 * capacity-alert, daily-allowance, metering, metering-prune) and nothing in
 * the codebase ever wrote `healthy = true`: `markHealthy(false)` from the
 * config/consumption paths was a one-way trip — `updateBbbServer` cannot
 * write `healthy`, so a flagged server could never come back without raw
 * SQL. The probe is the recovery path as well as proactive detection.
 *
 * ── What it does ───────────────────────────────────────────────────────────
 * Every 5 minutes, one read-only signed `getMeetings` per ENABLED server:
 *   SUCCESS → healthy=true + lastHealthCheckAt stamp (recovers flagged rows);
 *   any typed BBB error → healthy=false + de-duplicated ops alert
 *   (`bbb-server-config` for rejected/misconfigured, `bbb-server-health`
 *   otherwise). One bad server never trips the task — failures are counted
 *   and returned, never thrown.
 *
 * ── Safety ─────────────────────────────────────────────────────────────────
 * Read-only on BBB (no end/create); W2-sanitized errors only; alerts are
 * deduped per (kind, server) for 1 h by BbbOpsAlertService, so a flapping
 * server alerts once per hour, not once per probe.
 */
export const bbbServerHealthTask = new ScheduledTask({
  id: "bbb-server-health",
  description:
    "Signed getMeetings probe per enabled BBB server (healthy flag + lastHealthCheckAt recovery)",
  schedule: (cron) => cron.every(5).minutes(),
  async execute({ injector }) {
    const serverService = injector.get(BbbServerService);
    try {
      const result = await serverService.runHealthProbe();
      if (result.flagged > 0 || result.recovered > 0) {
        Logger.log(
          `probe=${result.probed} flagged=${result.flagged} recovered=${result.recovered}`,
          loggerCtx,
        );
      }
      return result;
    } catch (err) {
      Logger.error(
        `BBB server health probe failed: ${(err as Error).message}`,
        loggerCtx,
        (err as Error).stack,
      );
      return { probed: 0, flagged: 0, recovered: 0 };
    }
  },
});