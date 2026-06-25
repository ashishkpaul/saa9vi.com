import { Entity, ManyToOne, Column, Unique } from "typeorm";
import { VendureEntity, Customer } from "@vendure/core";
import { ProductReview } from "./product-review.entity";

/**
 * Tracks individual customer votes on reviews to prevent duplicate voting.
 */
@Entity()
@Unique(["review", "customer"])
export class ReviewVote extends VendureEntity {
  constructor(input?: Partial<ReviewVote>) {
    super(input);
  }

  @ManyToOne("ProductReview", "votes")
  review: ProductReview;

  @ManyToOne("Customer")
  customer: Customer;

  @Column({ type: "boolean" })
  isUpvote: boolean;
}
