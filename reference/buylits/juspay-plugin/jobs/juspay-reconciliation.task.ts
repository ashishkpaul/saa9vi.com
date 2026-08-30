import { ScheduledTask, Injector } from '@vendure/core';
import { JuspayReconciliationJob } from './juspay-reconciliation.job';
import { Logger } from '@nestjs/common';

const loggerCtx = 'JuspayReconciliationTask';

/**
 * Scheduled task for Juspay reconciliation that runs every 15 minutes.
 * This replaces the setInterval approach for production safety.
 */
export const juspayReconciliationTask = new ScheduledTask({
    id: 'juspay-reconciliation',
    description: 'Reconcile missed Juspay payments every 15 minutes',
    schedule: cron => cron.every(15).minutes(),
    async execute({ injector }) {
        const reconciliationJob = injector.get(JuspayReconciliationJob);
        await reconciliationJob.reconcilePendingPayments();
        
        Logger.log('Juspay reconciliation task completed', loggerCtx);
        
        return { success: true };
    },
});
