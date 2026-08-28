import { ScheduledTask } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { SubscriptionRenewalService } from "../services/subscription-renewal.service";

const loggerCtx = "SubscriptionRenewalTask";

/**
 * Periodically triggers the subscription renewal process.
 */
export const subscriptionRenewalTask = new ScheduledTask({
  id: "subscription-renewal",
  description: "Process organization subscription renewals and dunning cycles",
  schedule: (cron) => cron.every(10).minutes(),
  async execute({ injector }) {
    const renewalService = injector.get(SubscriptionRenewalService);
    const { enqueued, failures } = await renewalService.processRenewals();

    if (enqueued > 0 || failures > 0) {
      Logger.log(
        `Renewal discovery finished: enqueued=${enqueued} failures=${failures}`,
        loggerCtx,
      );
    }

    return { enqueued, failures };
  },
});
