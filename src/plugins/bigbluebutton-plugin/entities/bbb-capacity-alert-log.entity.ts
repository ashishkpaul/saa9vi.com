import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity } from "typeorm";

/**
 * Append-only audit trail for capacity intelligence alerts.
 *
 * Rows are never updated or deleted (INV-002 extended to alerting domain per ADR v1.7 CI-004).
 * Operators can retrospectively audit when the system flagged a capacity risk and
 * whether a server was added in time.
 *
 * See ADR v1.7 §6A CI-004.
 */
@Entity("bbb_capacity_alert_log")
export class BbbCapacityAlertLog extends VendureEntity {
  constructor(input?: DeepPartial<BbbCapacityAlertLog>) {
    super(input);
  }

  @Column()
  checkedAt: Date;

  /**
   * Urgency level based on projected peak load vs total pool capacity.
   * - none: ≤ 60%
   * - plan: > 60% and ≤ 75%
   * - soon: > 75% and ≤ 90%
   * - immediate: > 90%
   */
  @Column({ type: "simple-enum", enum: ["none", "plan", "soon", "immediate"] })
  urgency: "none" | "plan" | "soon" | "immediate";

  /** Number of additional servers recommended to meet target utilization (70%) */
  @Column({ type: "int" })
  serversNeeded: number;

  /** Projected peak load as percentage of current total capacity */
  @Column({ type: "float" })
  peakForecastPercent: number;

  /** When the projected peak load is expected to occur (next 48 hours) */
  @Column({ type: 'timestamp', nullable: true })
  peakForecastAt: Date | null;

  /** Plain English explanation of the recommendation */
  @Column({ nullable: true, type: "text" })
  reasoning: string | null;
}
