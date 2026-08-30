import { Injectable, Logger } from '@nestjs/common';
import { TransactionalConnection, PaymentService, RequestContextService } from '@vendure/core';
import { JuspaySdk } from '../../payments-core/gateway/juspay-sdk';
import { Payment } from '@vendure/core/dist/entity/payment/payment.entity';

/**
 * Reconciliation worker that checks for missed Juspay payments
 * and settles them if they were successfully charged but webhook was missed.
 * 
 * This job is scheduled via DefaultSchedulerPlugin, not setInterval.
 */
@Injectable()
export class JuspayReconciliationJob {
  private readonly logger = new Logger('JuspayReconciliationJob');

  constructor(
    private connection: TransactionalConnection,
    private sdk: JuspaySdk,
    private paymentService: PaymentService,
    private requestContextService: RequestContextService,
  ) {}

  /**
   * Reconcile pending payments - this method will be called by the scheduler
   */
  async reconcilePendingPayments(): Promise<void> {
    const repo = this.connection.getRepository(Payment);

    // Find all payments that are Authorized but not yet Settled
    const pendingPayments = await repo.find({
      where: { state: 'Authorized' }
    });

    this.logger.log(`Found ${pendingPayments.length} pending payments to reconcile`);

    for (const payment of pendingPayments) {
      try {
        // Get Juspay order ID from payment metadata
        const juspayOrderId = payment.metadata?.juspayOrderId;

        if (!juspayOrderId) {
          this.logger.verbose(`Payment ${payment.id} has no Juspay order ID, skipping`);
          continue;
        }

        // Check Juspay for the actual status
        const status = await this.sdk.getOrderStatus(juspayOrderId);

        this.logger.verbose(
          `Reconciliation check: payment=${payment.id} juspayOrderId=${juspayOrderId} status=${status.status}`
        );

        if (status.status === 'CHARGED') {
          // Payment was successfully charged, settle it
          await this.settlePayment(payment);
        } else if (status.status === 'PENDING_VBV') {
          // Still pending, continue to wait
          this.logger.verbose(`Payment ${payment.id} still pending 3DS verification`);
        } else {
          // Payment failed or was declined
          this.logger.warn(
            `Payment ${payment.id} has status ${status.status}, not settling`
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to reconcile payment ${payment.id}: ${error}`,
          error as Error
        );
      }
    }
  }

  private async settlePayment(payment: Payment): Promise<void> {
    try {
      // Create a system context for the payment service
      const ctx = await this.requestContextService.create({ apiType: 'admin' });

      // Settle the payment
      await this.paymentService.settlePayment(ctx, payment.id);

      this.logger.log(
        `Successfully settled payment ${payment.id} via reconciliation worker`
      );
    } catch (error) {
      this.logger.error(
        `Failed to settle payment ${payment.id} during reconciliation: ${error}`,
        error as Error
      );
      throw error;
    }
  }
}
