import { gql } from "graphql-tag";

export const commonApiExtensions = gql`
  type ProductReview implements Node {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    product: Product!
    productVariant: ProductVariant
    summary: String!
    body: String
    rating: Float!
    authorName: String!
    authorLocation: String
    upvotes: Int!
    downvotes: Int!
    state: String!
    verifiedPurchase: Boolean!
    incentivized: Boolean!
    response: String
    responseCreatedAt: DateTime
    userVote: String
    assets: [Asset!]
  }

  type ProductReviewList implements PaginatedList {
    items: [ProductReview!]!
    totalItems: Int!
  }

  type ProductReviewHistogramItem {
    bin: Int!
    frequency: Int!
  }

  type ReviewEligibilityResult {
    eligible: Boolean!
    reason: String!
    hasPurchased: Boolean!
    hasExistingReview: Boolean!
    eligibleOrderId: ID
    eligibleOrderLineId: ID
  }

  type ReviewRequestResult {
    id: ID!
    status: String!
    scheduledAt: DateTime!
    sentAt: DateTime
    reviewedAt: DateTime
    reminderCount: Int!
    expiresAt: DateTime!
    reviewToken: String!
    openedAt: DateTime
    clickCount: Int!
    product: Product!
    order: Order!
  }

  type ReviewRequestList {
    items: [ReviewRequestResult!]!
    totalItems: Int!
  }

  extend type Product {
    reviews(options: ProductReviewListOptions): ProductReviewList!
    reviewsHistogram: [ProductReviewHistogramItem!]!
  }

  input ProductReviewListOptions {
    filter: ProductReviewFilterInput
    sort: ProductReviewSortInput
    skip: Int
    take: Int
  }

  input ProductReviewFilterInput {
    state: StringOperators
    rating: NumberOperators
    createdAt: DateOperators
    authorName: StringOperators
  }

  input ProductReviewSortInput {
    createdAt: SortOrder
    rating: SortOrder
    upvotes: SortOrder
  }
`;

export const adminApiExtensions = gql`
  ${commonApiExtensions}

  input UpdateProductReviewInput {
    id: ID!
    summary: String
    body: String
    response: String
  }

  extend type ProductReview {
    author: Customer
  }

  extend type Query {
    productReviews(options: ProductReviewListOptions): ProductReviewList!
    productReview(id: ID!): ProductReview
  }

  extend type Mutation {
    updateProductReview(input: UpdateProductReviewInput!): ProductReview!
    approveProductReview(id: ID!): ProductReview
    rejectProductReview(id: ID!): ProductReview
    hideProductReview(id: ID!): ProductReview
    flagProductReview(id: ID!, reason: String): ProductReview
    respondToReview(id: ID!, response: String!): ProductReview
  }
`;

export const shopApiExtensions = gql`
  ${commonApiExtensions}

  input SubmitProductReviewInput {
    productId: ID!
    variantId: ID
    orderId: ID
    orderLineId: ID
    summary: String!
    body: String!
    rating: Float!
    authorName: String
    authorLocation: String
    reviewToken: String
    assetIds: [ID!]
  }

  enum ReviewReportReason {
    SPAM
    OFFENSIVE
    IRRELEVANT
    FAKE
    OTHER
  }

  input ReportReviewInput {
    id: ID!
    reason: ReviewReportReason!
    comment: String
  }

  extend type Query {
    canReviewProduct(productId: ID!): ReviewEligibilityResult!
    pendingReviewRequests(options: ProductReviewListOptions): ReviewRequestList!
    validateReviewToken(token: String!): ReviewRequestResult
  }

  extend type Mutation {
    submitProductReview(input: SubmitProductReviewInput!): ProductReview!
    voteOnReview(id: ID!, vote: Boolean!): ProductReview!
    reportReview(input: ReportReviewInput!): Boolean!
  }
`;
