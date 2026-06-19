import { Injectable, Logger } from "@nestjs/common";

/**
 * Lightweight in-memory metrics collector for BBB operations.
 *
 * Provides visibility into lock contention, provisioning latency,
 * enqueue patterns, reconciliation corrections, and Redis degradation.
 *
 * This is intentionally kept simple — it uses in-memory counters.
 * For production observability, emit these as Prometheus metrics
 * via @willsoto/nestjs-prometheus or similar.
 */
@Injectable()
export class BbbMetricsService {
  private readonly logger = new Logger(BbbMetricsService.name);

  // ─── Lock Metrics ──────────────────────────────────────────────────────────

  private lockAcquired = 0;
  private lockContention = 0;
  private lockRedisFailure = 0;
  private lockHeartbeatExtended = 0;
  private lockHeartbeatFailed = 0;

  // ─── Provisioning Metrics ─────────────────────────────────────────────────

  private provisioningEnqueued = 0;
  private provisioningSuppressed = 0;
  private provisioningSucceeded = 0;
  private provisioningFailed = 0;
  private provisioningLatencyMs: number[] = [];

  // ─── Reconciliation Metrics ───────────────────────────────────────────────

  private reconciliationProvisioningFixed = 0;
  private reconciliationActiveReconciled = 0;
  private reconciliationRoomsReconciled = 0;

  // ─── Lifecycle Metrics ────────────────────────────────────────────────────

  private staleActiveDetected = 0;
  private staleActiveRecovered = 0;
  private reprovisionTriggered = 0;
  private runtimeValidationFailed = 0;
  private webhookCompletionCount = 0;
  private webhookParseFailures = 0;
  private duplicateCompletionPrevented = 0;
  private billingSuccess = 0;
  private billingFailed = 0;

  // ─── API Metrics ──────────────────────────────────────────────────────────

  private bbbCreateMeetingSuccess = 0;
  private bbbCreateMeetingFailed = 0;
  private bbbEndMeetingSuccess = 0;
  private bbbEndMeetingFailed = 0;
  private bbbIsMeetingRunningSuccess = 0;
  private bbbIsMeetingRunningFailed = 0;

  // ─── Lock Metrics ─────────────────────────────────────────────────────────

  recordLockAcquired(): void {
    this.lockAcquired++;
  }

  recordLockContention(): void {
    this.lockContention++;
  }

  recordLockRedisFailure(): void {
    this.lockRedisFailure++;
  }

  recordLockHeartbeatExtended(): void {
    this.lockHeartbeatExtended++;
  }

  recordLockHeartbeatFailed(): void {
    this.lockHeartbeatFailed++;
  }

  // ─── Provisioning Metrics ─────────────────────────────────────────────────

  recordProvisioningEnqueued(): void {
    this.provisioningEnqueued++;
  }

  recordProvisioningSuppressed(): void {
    this.provisioningSuppressed++;
  }

  recordProvisioningSucceeded(latencyMs: number): void {
    this.provisioningSucceeded++;
    this.provisioningLatencyMs.push(latencyMs);
    // Keep only last 1000 samples to bound memory
    if (this.provisioningLatencyMs.length > 1000) {
      this.provisioningLatencyMs.shift();
    }
  }

  recordProvisioningFailed(): void {
    this.provisioningFailed++;
  }

  // ─── Reconciliation Metrics ───────────────────────────────────────────────

  recordReconciliationProvisioningFixed(): void {
    this.reconciliationProvisioningFixed++;
  }

  recordReconciliationActiveReconciled(): void {
    this.reconciliationActiveReconciled++;
  }

  recordReconciliationRoomsReconciled(): void {
    this.reconciliationRoomsReconciled++;
  }

  // ─── Lifecycle Metrics ────────────────────────────────────────────────────

  recordStaleActiveDetected(): void {
    this.staleActiveDetected++;
  }

  recordStaleActiveRecovered(): void {
    this.staleActiveRecovered++;
  }

  recordReprovisionTriggered(): void {
    this.reprovisionTriggered++;
  }

  recordRuntimeValidationFailed(): void {
    this.runtimeValidationFailed++;
  }

  recordWebhookCompletion(): void {
    this.webhookCompletionCount++;
  }

  recordWebhookParseFailure(): void {
    this.webhookParseFailures++;
  }

  recordDuplicateCompletionPrevented(): void {
    this.duplicateCompletionPrevented++;
  }

  recordBillingSuccess(): void {
    this.billingSuccess++;
  }

  recordBillingFailed(): void {
    this.billingFailed++;
  }

  // ─── BBB API Metrics ──────────────────────────────────────────────────────

  recordBbbCreateMeetingSuccess(): void {
    this.bbbCreateMeetingSuccess++;
  }

  recordBbbCreateMeetingFailed(): void {
    this.bbbCreateMeetingFailed++;
  }

  recordBbbEndMeetingSuccess(): void {
    this.bbbEndMeetingSuccess++;
  }

  recordBbbEndMeetingFailed(): void {
    this.bbbEndMeetingFailed++;
  }

  recordBbbIsMeetingRunningSuccess(): void {
    this.bbbIsMeetingRunningSuccess++;
  }

  recordBbbIsMeetingRunningFailed(): void {
    this.bbbIsMeetingRunningFailed++;
  }

  // ─── Summary ──────────────────────────────────────────────────────────────

  /**
   * Returns a snapshot of all accumulated metrics.
   * Call this periodically (e.g., via reconciliation interval) to log or export.
   */
  snapshot(): BbbMetricsSnapshot {
    const avgLatency =
      this.provisioningLatencyMs.length > 0
        ? Math.round(
            this.provisioningLatencyMs.reduce((a, b) => a + b, 0) /
              this.provisioningLatencyMs.length,
          )
        : 0;

    return {
      lock: {
        acquired: this.lockAcquired,
        contention: this.lockContention,
        redisFailure: this.lockRedisFailure,
        heartbeatExtended: this.lockHeartbeatExtended,
        heartbeatFailed: this.lockHeartbeatFailed,
      },
      provisioning: {
        enqueued: this.provisioningEnqueued,
        suppressed: this.provisioningSuppressed,
        succeeded: this.provisioningSucceeded,
        failed: this.provisioningFailed,
        avgLatencyMs: avgLatency,
      },
      reconciliation: {
        provisioningFixed: this.reconciliationProvisioningFixed,
        activeReconciled: this.reconciliationActiveReconciled,
        roomsReconciled: this.reconciliationRoomsReconciled,
      },
      lifecycle: {
        staleActiveDetected: this.staleActiveDetected,
        staleActiveRecovered: this.staleActiveRecovered,
        reprovisionTriggered: this.reprovisionTriggered,
        runtimeValidationFailed: this.runtimeValidationFailed,
        webhookCompletionCount: this.webhookCompletionCount,
        webhookParseFailures: this.webhookParseFailures,
        duplicateCompletionPrevented: this.duplicateCompletionPrevented,
        billingSuccess: this.billingSuccess,
        billingFailed: this.billingFailed,
      },
      bbbApi: {
        createMeetingSuccess: this.bbbCreateMeetingSuccess,
        createMeetingFailed: this.bbbCreateMeetingFailed,
        endMeetingSuccess: this.bbbEndMeetingSuccess,
        endMeetingFailed: this.bbbEndMeetingFailed,
        isMeetingRunningSuccess: this.bbbIsMeetingRunningSuccess,
        isMeetingRunningFailed: this.bbbIsMeetingRunningFailed,
      },
    };
  }

  /**
   * Logs a human-readable summary of all metrics to the application log.
   */
  logSnapshot(): void {
    const s = this.snapshot();
    this.logger.log(
      `[BBB Metrics] ` +
        `Lock{acquired=${s.lock.acquired} contention=${s.lock.contention} redisFail=${s.lock.redisFailure} hbExt=${s.lock.heartbeatExtended} hbFail=${s.lock.heartbeatFailed}} ` +
        `Provisioning{enqueued=${s.provisioning.enqueued} suppressed=${s.provisioning.suppressed} ok=${s.provisioning.succeeded} fail=${s.provisioning.failed} avgLat=${s.provisioning.avgLatencyMs}ms} ` +
        `Reconciliation{provFixed=${s.reconciliation.provisioningFixed} active=${s.reconciliation.activeReconciled} rooms=${s.reconciliation.roomsReconciled}} ` +
        `Lifecycle{staleDetected=${s.lifecycle.staleActiveDetected} staleRecovered=${s.lifecycle.staleActiveRecovered} reprovision=${s.lifecycle.reprovisionTriggered} runtimeFail=${s.lifecycle.runtimeValidationFailed} webhookDone=${s.lifecycle.webhookCompletionCount} webhookParseFail=${s.lifecycle.webhookParseFailures} duplicateBlocked=${s.lifecycle.duplicateCompletionPrevented} billingOk=${s.lifecycle.billingSuccess} billingFail=${s.lifecycle.billingFailed}} ` +
        `BBB API{createOk=${s.bbbApi.createMeetingSuccess} createFail=${s.bbbApi.createMeetingFailed} endOk=${s.bbbApi.endMeetingSuccess} endFail=${s.bbbApi.endMeetingFailed} isRunningOk=${s.bbbApi.isMeetingRunningSuccess} isRunningFail=${s.bbbApi.isMeetingRunningFailed}}`,
    );
  }

  /**
   * Resets all accumulated counters. Useful for periodic snapshots
   * where you want deltas between intervals.
   */
  reset(): void {
    this.lockAcquired = 0;
    this.lockContention = 0;
    this.lockRedisFailure = 0;
    this.lockHeartbeatExtended = 0;
    this.lockHeartbeatFailed = 0;
    this.provisioningEnqueued = 0;
    this.provisioningSuppressed = 0;
    this.provisioningSucceeded = 0;
    this.provisioningFailed = 0;
    this.provisioningLatencyMs = [];
    this.reconciliationProvisioningFixed = 0;
    this.reconciliationActiveReconciled = 0;
    this.reconciliationRoomsReconciled = 0;
    this.staleActiveDetected = 0;
    this.staleActiveRecovered = 0;
    this.reprovisionTriggered = 0;
    this.runtimeValidationFailed = 0;
    this.webhookCompletionCount = 0;
    this.webhookParseFailures = 0;
    this.duplicateCompletionPrevented = 0;
    this.billingSuccess = 0;
    this.billingFailed = 0;
    this.bbbCreateMeetingSuccess = 0;
    this.bbbCreateMeetingFailed = 0;
    this.bbbEndMeetingSuccess = 0;
    this.bbbEndMeetingFailed = 0;
    this.bbbIsMeetingRunningSuccess = 0;
    this.bbbIsMeetingRunningFailed = 0;
  }
}

export interface BbbMetricsSnapshot {
  lock: {
    acquired: number;
    contention: number;
    redisFailure: number;
    heartbeatExtended: number;
    heartbeatFailed: number;
  };
  provisioning: {
    enqueued: number;
    suppressed: number;
    succeeded: number;
    failed: number;
    avgLatencyMs: number;
  };
  reconciliation: {
    provisioningFixed: number;
    activeReconciled: number;
    roomsReconciled: number;
  };
  lifecycle: {
    staleActiveDetected: number;
    staleActiveRecovered: number;
    reprovisionTriggered: number;
    runtimeValidationFailed: number;
    webhookCompletionCount: number;
    webhookParseFailures: number;
    duplicateCompletionPrevented: number;
    billingSuccess: number;
    billingFailed: number;
  };
  bbbApi: {
    createMeetingSuccess: number;
    createMeetingFailed: number;
    endMeetingSuccess: number;
    endMeetingFailed: number;
    isMeetingRunningSuccess: number;
    isMeetingRunningFailed: number;
  };
}
