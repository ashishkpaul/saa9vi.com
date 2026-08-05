import { Channel, ChannelAware, Customer, VendureEntity } from "@vendure/core";
import type { DeepPartial } from "@vendure/core";
import {
  Column,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

import { ProductReview } from "./product-review.entity";

/**
 * Tracks reports/flags submitted against reviews for abuse handling.
 * Supports moderation workflow for handling inappropriate reviews.
 */
@Entity()
@Index("idx_review_report_review", ["review"])
@Index("idx_review_report_reporter", ["reporter"])
@Index("idx_review_report_status", ["status"])
@Index("idx_review_report_reason", ["reason"])
@Index("idx_review_report_channel", ["channelId"])
export class ReviewReport extends VendureEntity implements ChannelAware {
  constructor(input?: DeepPartial<ReviewReport>) {
    super(input);
  }

  @ManyToMany(() => Channel)
  @JoinTable()
  channels: Channel[];

  @Column()
  channelId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => ProductReview, { onDelete: "CASCADE" })
  review: ProductReview;

  @Column()
  reviewId: string;

  @ManyToOne(() => Customer, { onDelete: "CASCADE" })
  reporter: Customer;

  @Column()
  reporterId: string;

  /**
   * Reason for reporting: 'spam', 'inappropriate', 'fake', 'offensive', 'other'
   */
  @Column({ type: "varchar", length: 50 })
  reason: string;

  /**
   * Detailed description of the issue
   */
  @Column("text", { nullable: true })
  description: string | null;

  /**
   * Status: 'pending', 'reviewed', 'action_taken', 'dismissed'
   */
  @Column({ type: "varchar", length: 20, default: "pending" })
  status: string;

  /**
   * Admin who reviewed the report
   */
  @Column({ type: "varchar", nullable: true })
  reviewedByAdminId: string | null;

  /**
   * When the report was reviewed
   */
  @Column({ type: "timestamp", nullable: true })
  reviewedAt: Date | null;

  /**
   * Action taken: 'none', 'review_hidden', 'review_deleted', 'user_warned'
   */
  @Column({ type: "varchar", length: 50, nullable: true })
  actionTaken: string | null;

  /**
   * Admin notes on the report
   */
  @Column("text", { nullable: true })
  adminNotes: string | null;

  /**
   * IP address of the reporter (for fraud detection)
   */
  @Column({ type: "varchar", length: 45, nullable: true })
  reporterIp: string | null;

  /**
   * User agent of the reporter
   */
  @Column({ type: "varchar", length: 500, nullable: true })
  reporterUserAgent: string | null;
}
