import { ScheduledTask } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { BbbReconciliationService } from "../services/bbb-reconciliation.service";
import { BbbMetricsService } from "../services/bbb-metrics.service";

const loggerCtx = "BbbReconciliationTask";

export const bbbReconciliationTask = new ScheduledTask({
  id: "bbb-reconciliation",
  description: "Reconcile BBB meeting states, room drift, and stuck provisioning",
  schedule: (cron) => cron.every(5).minutes(),
  async execute({ injector }) {
    const reconciliationService = injector.get(BbbReconciliationService);
    const metricsService = injector.get(BbbMetricsService);

    metricsService.logSnapshot();
    metricsService.reset();

    const [provisioningFixed, activeReconciled, roomsReconciled, billingRecovered] =
      await Promise.all([
        reconciliationService.reconcileProvisioning(),
        reconciliationService.reconcileActiveMeetings(),
        reconciliationService.reconcileRooms(),
        reconciliationService.reconcilePendingBilling(),
      ]);

    if (
      provisioningFixed > 0 ||
      activeReconciled > 0 ||
      roomsReconciled > 0 ||
      billingRecovered > 0
    ) {
      Logger.log(
        `provisioningFixed=${provisioningFixed} activeReconciled=${activeReconciled} roomsReconciled=${roomsReconciled} billingRecovered=${billingRecovered}`,
        loggerCtx,
      );
    }

    return { provisioningFixed, activeReconciled, roomsReconciled, billingRecovered };
  },
});
