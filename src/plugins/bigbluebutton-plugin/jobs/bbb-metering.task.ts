import { ScheduledTask } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { BbbMeteringService } from "../services/bbb-metering.service";

const loggerCtx = "BbbMeteringTask";

/**
 * ADR-047 Phase 2B — per-minute metered sampling tick.
 *
 * Follows the same id-dedupe registration pattern as the reconciliation task
 * (`bigbluebutton.plugin.ts`): the `id` is the dedupe key. The underlying
 * write is idempotent (`ON CONFLICT (meetingId, bucketMinute) DO NOTHING`),
 * so an extra or overlapping run can never double-count minutes — same
 * reasoning as the daily-allowance hourly sweep.
 *
 * Failure handling: the sweep never throws. `sampleActiveMeetings` already
 * isolates per-meeting failures; this task only guards the top-level call so
 * a single bad tick cannot trip the scheduler.
 */
export const bbbMeteringTask = new ScheduledTask({
  id: "bbb-metering",
  description: "Sample live metered meetings into per-minute learner counts",
  schedule: (cron) => cron.every(1).minutes(),
  async execute({ injector }) {
    const meteringService = injector.get(BbbMeteringService);
    try {
      const { scanned, sampled, skipped, failed } =
        await meteringService.sampleActiveMeetings();
      if (sampled > 0 || failed > 0) {
        Logger.log(
          `Metering tick: scanned=${scanned} sampled=${sampled} skipped=${skipped} failed=${failed}`,
          loggerCtx,
        );
      }
      return { scanned, sampled, skipped, failed };
    } catch (err) {
      Logger.error(
        `Metering tick failed: ${(err as Error).message}`,
        loggerCtx,
        (err as Error).stack,
      );
      return { scanned: 0, sampled: 0, skipped: 0, failed: 0 };
    }
  },
});
