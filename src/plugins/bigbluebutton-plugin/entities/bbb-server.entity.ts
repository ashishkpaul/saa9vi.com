import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity } from "typeorm";

/**
 * Represents a BigBlueButton server. The apiSecret is stored encrypted at rest.
 * Use BbbApiService to decrypt before use — never expose via GraphQL.
 */
@Entity("bbb_server")
export class BbbServer extends VendureEntity {
  constructor(input?: DeepPartial<BbbServer>) {
    super(input);
  }

  @Column({ unique: true })
  name: string;

  /**
   * BBB API base, WITHOUT the trailing `/api` and without a trailing slash
   * (request URLs are always built as `<apiUrl>/api/<methodName>`).
   * e.g. https://bbb.example.com/bigbluebutton
   *
   * Both paste shapes operators use (`…/bigbluebutton` and
   * `…/bigbluebutton/api`, with or without a trailing slash) are canonicalised
   * on save AND re-canonicalised at request-build time
   * (`shared/bbb-api-url.ts`), so legacy rows are served correctly with NO
   * data migration and no hand-edited rows.
   */
  @Column()
  apiUrl: string;

  /**
   * Tracks which encryption key version was used to encrypt the API secret below.
   * Incremented via zero-downtime key rotation (see DA-003).
   */
  @Column({ default: 1 })
  encryptionKeyVersion: number;

  /**
   * AES-256-GCM encrypted BBB API secret.
   * select: false — never returned in queries by default.
   */
  @Column({ select: false })
  encryptedApiSecret: string;

  @Column({ default: true })
  enabled: boolean;

  /**
   * Selection load value — an OPAQUE integer input to server selection.
   *
   * Relabelled 2026-10-07 from the earlier "load score" wording, which
   * claimed `BbbReconciliationService.reconcileServerLoad()` maintained a
   * composite score from active meetings and participants — that method
   * has never existed in code (BUG-014 doc drift). Verified reality:
   * written only at insert (default 0), with NO runtime updater.
   * Consequences today: every enabled+healthy server ties at 0, so
   * `BbbServerSelectionService` picks randomly among them (its min-load
   * jitter), and CapacityIntelligenceService's
   * `loadPercent = currentLoad / capacity × 100` reads 0.
   *
   * Intentionally opaque to `BbbServerSelectionService` — it only filters
   * (`currentLoad < maxLoad`) and sorts by this column, so a future
   * composite updater can land without touching the selection algorithm.
   */
  @Column({ default: 0 })
  currentLoad: number;

  /**
   * Maximum tolerated selection load value (same units as currentLoad).
   *
   * Servers with `currentLoad >= maxLoad` are excluded from selection.
   * Default 100; operators set it via the dashboard "Max Load" field.
   */
  @Column({ default: 100 })
  maxLoad: number;

  @Column({ default: true })
  healthy: boolean;

  @Column({ nullable: true })
  lastHealthCheckAt: Date;

  /**
   * Operator-configured maximum virtual load value (same units as currentLoad)
   * for this server's hardware spec.
   * Used by CapacityIntelligenceService for pool-level headroom calculations.
   *
   * Not used by BbbServerSelectionService — that service continues to use
   * currentLoad < maxLoad for selection (DL-014 preserved).
   *
   * Default 200 ≈ a 4-core 8GB VM at moderate session density.
   * A 8-core 16GB server would typically be configured with capacity: 500.
   *
   * See ADR v1.7 CI-001.
   */
  @Column({ default: 200 })
  capacity: number;
}
