import { Customer, Order, Product, VendureEntity } from "@vendure/core";
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { ProductReview } from "./product-review.entity";

/**
 * Tracks incentives given to customers for writing reviews.
 * Supports various reward types like discount codes, loyalty points, etc.
 */
@Entity()
@Index("idx_review_reward_customer", ["customer"])
@Index("idx_review_reward_review", ["review"])
@Index("idx_review_reward_status", ["status"])
export class ReviewReward extends VendureEntity {
  constructor(input?: Partial<ReviewReward>) {
    super(input);
  }

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Customer, { onDelete: "CASCADE" })
  customer: Customer;

  @Column()
  customerId: string;

  @ManyToOne(() => ProductReview, { onDelete: "CASCADE" })
  review: ProductReview;

  @Column()
  reviewId: string;

  @ManyToOne(() => Product, { onDelete: "CASCADE" })
  product: Product;

  @Column()
  productId: string;

  @ManyToOne(() => Order, { onDelete: "SET NULL", nullable: true })
  order: Order | null;

  @Column({ nullable: true })
  orderId: string | null;

  /**
   * Type of reward: 'discount_code', 'loyalty_points', 'cashback', 'free_product'
   */
  @Column({ type: "varchar", length: 50 })
  rewardType: string;

  /**
   * The value of the reward (e.g., discount amount, points, cashback amount)
   */
  @Column("decimal", { precision: 10, scale: 2 })
  rewardValue: number;

  /**
   * Currency code for monetary rewards
   */
  @Column({ type: "varchar", length: 3, nullable: true })
  currencyCode: string | null;

  /**
   * Unique code for the reward (e.g., discount code)
   */
  @Column({ type: "varchar", length: 100, nullable: true, unique: true })
  rewardCode: string | null;

  /**
   * Status: 'pending', 'granted', 'redeemed', 'expired', 'revoked'
   */
  @Column({ type: "varchar", length: 20, default: "pending" })
  status: string;

  /**
   * When the reward was granted to the customer
   */
  @Column({ nullable: true })
  grantedAt: Date | null;

  /**
   * When the reward expires (if applicable)
   */
  @Column({ nullable: true })
  expiresAt: Date | null;

  /**
   * When the reward was redeemed
   */
  @Column({ nullable: true })
  redeemedAt: Date | null;

  /**
   * If the review was incentivized, this tracks the disclosure
   */
  @Column({ default: false })
  isIncentivized: boolean;

  /**
   * Additional metadata (JSON)
   */
  @Column("text", { nullable: true })
  metadata: string | null;
}
