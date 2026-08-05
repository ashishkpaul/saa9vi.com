import { Entity, ManyToOne, Column, Unique, JoinTable, ManyToMany, Index } from "typeorm";
import { VendureEntity, Customer, Channel, ChannelAware } from "@vendure/core";
import { ProductReview } from "./product-review.entity";

/**
 * Tracks individual customer votes on reviews to prevent duplicate voting.
 */
@Entity()
@Unique(["review", "customer"])
@Index("IDX_review_vote_channel", ["channelId"])
export class ReviewVote extends VendureEntity implements ChannelAware {
  constructor(input?: Partial<ReviewVote>) {
    super(input);
  }

  @ManyToMany(() => Channel)
  @JoinTable()
  channels: Channel[];

  @Column()
  channelId: string;

  @ManyToOne("ProductReview", "votes")
  review: ProductReview;

  @ManyToOne("Customer")
  customer: Customer;

  @Column({ type: "boolean" })
  isUpvote: boolean;
}
