/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Asset,
  Customer,
  Order,
  OrderLine,
  Product,
  ProductVariant,
  VendureEntity,
} from "@vendure/core";
import type { DeepPartial } from "@vendure/core";
import {
  Column,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
} from "typeorm";

import type { ReviewState } from "../types";
import { ReviewVote } from "./review-vote.entity";

@Entity()
@Index("IDX_review_product_state", ["product", "state"])
@Index("IDX_review_state", ["state"])
@Index("IDX_review_product_customer", ["product", "author"], { unique: true })
export class ProductReview extends VendureEntity {
  constructor(input?: DeepPartial<ProductReview>) {
    super(input);
  }

  @ManyToOne(() => Product, { onDelete: "CASCADE" })
  product: Product;

  @ManyToOne(() => ProductVariant, { nullable: true, onDelete: "SET NULL" })
  productVariant: ProductVariant | null;

  @ManyToOne(() => Order, { nullable: true, onDelete: "SET NULL" })
  order: Order | null;

  @ManyToOne(() => OrderLine, { nullable: true, onDelete: "SET NULL" })
  orderLine: OrderLine | null;

  @Column()
  summary: string;

  @Column("text")
  body: string;

  @Column()
  rating: number;

  @ManyToOne(() => Customer, { nullable: true, onDelete: "SET NULL" })
  author: Customer | null;

  @Column()
  authorName: string;

  @Column({ nullable: true })
  authorLocation: string;

  @Column({ default: 0 })
  upvotes: number;

  @Column({ default: 0 })
  downvotes: number;

  @Column("varchar", { default: "new" })
  state: ReviewState;

  @Column({ default: false })
  verifiedPurchase: boolean;

  @Column({ default: false })
  isIncentivized: boolean;

  @Column({ nullable: true, default: null })
  editedAt: Date;

  @Column("text", { nullable: true, default: null })
  response: string;

  @Column({ nullable: true, default: null })
  responseCreatedAt: Date;

  @OneToMany(() => ReviewVote, (vote) => vote.review)
  votes: ReviewVote[];

  @ManyToMany(() => Asset, { cascade: true })
  @JoinTable()
  assets: Asset[];
}
