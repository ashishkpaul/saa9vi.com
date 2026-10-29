import { ScheduledTask } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { BbbServerLoadService } from "../services/bbb-server-load.service";

const loggerCtx = "BbbServerLoadTask";

/**
 * 1-minute measured-load tick for every enabled BBB server.
 *
 * Calls BbbServerLoadService.refreshAll(), which polls each enabled server
 * via getMeetings, computes load with the Phase 1 pure policy, and persists
 * currentLoad / liveMeetings / liveParticipants / loadUpdatedAt.
 *
 * One failing server never fails the tick; errors are counted and logged,
 * never thrown. This task runs 5x as often as the 5-minute health probe
 * and never writes `healthy` or raises alerts — that remains the probe's
 * domain (INV-012: load is advisory).
 */
export const bbbServerLoadTask = new ScheduledTask({
  id: "bbb-server-load",
  description:
    "1-minute measured-load poll of every enabled BBB server (currentLoad, liveMeetings, liveParticipants, loadUpdatedAt)",
  schedule: (cron) => cron.every(1).minutes(),
  async execute({ injector }) {
    const loadService = injector.get(BbbServerLoadService);
    try {
      const result = await loadService.refreshAll();
      Logger.log(
        `load tick: polled=${result.polled} updated=${result.updated} failed=${result.failed}`,
        loggerCtx,
      );
      return result;
    } catch (err) {
      Logger.error(
        `BBB server load tick failed: ${(err as Error).message}`,
        loggerCtx,
        (err as Error).stack,
      );
      return { polled: 0, updated: 0, failed: 0 };
    }
  },
});
