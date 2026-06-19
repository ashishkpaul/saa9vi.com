import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity } from "typeorm";

/**
 * Represents a BigBlueButton server. The apiSecret is stored encrypted at rest.
 * Use BbbApiService to decrypt before use — never expose via GraphQL.
 */
@Entity()
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
   * AES-256-GCM encrypted BBB API secret.
   * select: false — never returned in queries by default.
   */
  @Column({ select: false })
  encryptedApiSecret: string;

  @Column({ default: true })
  enabled: boolean;

  /** 0–100 — used by server selection strategy */
  @Column({ default: 0 })
  currentLoad: number;

  @Column({ default: 100 })
  maxLoad: number;

  @Column({ default: true })
  healthy: boolean;

  @Column({ nullable: true })
  lastHealthCheckAt: Date;
}
