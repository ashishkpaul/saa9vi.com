import {
  Customer,
  Order,
  OrderLine,
  Product,
  VendureEntity,
} from "@vendure/core";
import type { DeepPartial } from "@vendure/core";
import { Column, Entity, Index, ManyToOne, Unique } from "typeorm";

export type ReviewRequestStatus = "scheduled" | "sent" | "reviewed" | "expired";

@Entity()
@Unique("UQ_review_request_customer_product_order_line", ["customer", "product", "orderLine"])
@Index("IDX_review_request_customer_product", ["customer", "product"])
@Index("IDX_review_request_status", ["status"])
@Index("IDX_review_request_scheduled_at", ["scheduledAt"])
@Index("IDX_review_request_token", ["reviewToken"], { unique: true })
export class ReviewRequest extends VendureEntity {
  constructor(input?: DeepPartial<ReviewRequest>) {
    super(input);
  }

  @ManyToOne(() => Customer, { onDelete: "CASCADE" })
  customer: Customer;

  @ManyToOne(() => Product, { onDelete: "CASCADE" })
  product: Product;

  @ManyToOne(() => Order, { onDelete: "CASCADE" })
  order: Order;

  @ManyToOne(() => OrderLine, { nullable: true, onDelete: "SET NULL" })
  orderLine: OrderLine | null;

  @Column("varchar", { default: "scheduled" })
  status: ReviewRequestStatus;

  @Column()
  scheduledAt: Date;

  @Column({ nullable: true })
  sentAt: Date;

  @Column({ nullable: true })
  reviewedAt: Date;

  @Column({ default: 0 })
  reminderCount: number;

  @Column({ nullable: true })
  lastReminderAt: Date;

  @Column()
  expiresAt: Date;

  @Column({ unique: true })
  reviewToken: string;

  @Column({ nullable: true })
  openedAt: Date;

  @Column({ default: 0 })
  clickCount: number;

  @Column({ nullable: true })
  channelId: string;

  @Column({ default: false })
  isIncentivized: boolean;
}
