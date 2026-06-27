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

  /** e.g. https://bbb.example.com/bigbluebutton */
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
   * Current load score for server selection (0–100).
   *
   * Updated by `BbbReconciliationService.reconcileServerLoad()` which computes
   * a composite score from active meetings and participant counts. Lower scores
   * are preferred during selection.
   *
   * The score is intentionally opaque to `BbbServerSelectionService` — that
   * service only needs to filter (`currentLoad < maxLoad`) and sort by this
   * column. The reconciliation service owns the scoring formula and can evolve
   * it without touching the selection algorithm.
   */
  @Column({ default: 0 })
  currentLoad: number;

  /**
   * Maximum acceptable load score.
   *
   * Servers at or above this threshold are excluded from selection.
   * Default 100 means the scale is effectively 0–100.
   */
  @Column({ default: 100 })
  maxLoad: number;

  @Column({ default: true })
  healthy: boolean;

  @Column({ nullable: true })
  lastHealthCheckAt: Date;
}
