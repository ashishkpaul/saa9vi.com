import gql from 'graphql-tag';

export const shopApiExtensions = gql`
  type MarketplaceSession {
    id: ID!
    productVariantId: ID
    channelId: String!
    channelToken: String!
    title: String!
    startTime: DateTime!
    endTime: DateTime!
    priceInPaise: Int!
    academyName: String!
    academySlug: String!
    customDomain: String
    instructorName: String
    subjectTags: [String!]!
    bayesianRating: Float!
    """3D.1b: baseline version of the frozen {G,V} snapshot used for this score."""
    baselineVersion: Int
    isSponsored: Boolean!
  }

  type MarketplaceInstructor {
    id: ID!
    channelId: String!
    channelToken: String!
    name: String!
    bio: String!
    slug: String!
    photoUrl: String
    subjectTags: [String!]!
    reviewRating: Float
    academyName: String!
    academySlug: String!
  }

  type MarketplaceSearchResult {
    sessions: [MarketplaceSession!]!
    instructors: [MarketplaceInstructor!]!
    totalSessions: Int!
    totalInstructors: Int!
  }

  enum MarketplaceSessionSort {
    RELEVANCE
    PRICE_ASC
    PRICE_DESC
    SOONEST
  }

  input MarketplaceSearchInput {
    query: String!
    subjectTags: [String!]
    priceMin: Int
    priceMax: Int
    startFrom: String
    startTo: String
    sessionSort: MarketplaceSessionSort
    skip: Int
    take: Int
  }

  extend type Query {
    """
    Public marketplace search — no channel token required.
    Queries platform-level Elasticsearch indices for cross-tenant discovery.
    """
    marketplaceSearch(input: MarketplaceSearchInput!): MarketplaceSearchResult!
  }

  type MarketplaceReferenceApplyResult {
    ok: Boolean!
    orderId: ID
    code: String
  }

  extend type Mutation {
    """
    Attach a server-verified marketplace attribution reference to the active order.
    Discriminated result object (not a union):
      ok = true  -> orderId present, code null
      ok = false -> code present, orderId null
    The storefront only supplies the opaque marketplaceRef it received from the
    marketplace discovery API. Vendure resolves it (HMAC + TTL + channel binding)
    BEFORE storing, so the client can never select orderSource (INV-008; ADR-021
    Decisions 7 and 8). orderSource is never accepted nor written here; it is
    classified later at the order lifecycle boundary (3B.3 listener).
    """
    applyMarketplaceReference(ref: String!): MarketplaceReferenceApplyResult!
  }
`;

export const adminApiExtensions = gql`
  extend type Query {
    """
    Trigger a full reindex of all marketplace ES indices.
    Requires SuperAdmin permission.
    """
    marketplaceFullReindex: Boolean!
  }

  # ── Advertising: self-serve campaign management (3C.7a) ──────────

  enum CampaignType {
    sponsored_listing
    banner
  }

  enum CampaignStatus {
    draft
    active
    paused
    exhausted
  }

  enum WalletLedgerType {
    topup
    spend
    refund
  }

  type Campaign {
    id: ID!
    channelId: String!
    type: CampaignType!
    status: CampaignStatus!
    budgetInPaise: Int!
    spentInPaise: Int!
    targetSessionId: String
    targetSubject: String
    targetCity: String
    startsAt: DateTime!
    endsAt: DateTime!
    boostWeight: Float!
    createdAt: DateTime
    updatedAt: DateTime
  }

  type WalletLedgerEntry {
    id: ID!
    walletId: String!
    type: WalletLedgerType!
    amountInPaise: Int!
    occurredAt: DateTime!
    campaignId: String
    orderId: String
    reference: String
  }

  type SpendLedgerEntry {
    id: ID!
    campaignId: String!
    eventType: String!
    amountInPaise: Int!
    occurredAt: DateTime!
    orderId: String
  }

  input CreateCampaignInput {
    type: CampaignType!
    budgetInPaise: Int!
    targetSessionId: String
    targetSubject: String
    targetCity: String
    startsAt: DateTime!
    endsAt: DateTime!
    boostWeight: Float
  }

  input UpdateCampaignInput {
    budgetInPaise: Int
    targetSessionId: String
    targetSubject: String
    targetCity: String
    startsAt: DateTime
    endsAt: DateTime
    boostWeight: Float
  }

  extend type Query {
    """
    List campaigns for the caller's channel (SuperAdmin sees all).
    Requires MarketplaceAdvertising read permission.
    """
    campaigns: [Campaign!]!

    """
    Get a single campaign by ID. Channel-scoped.
    Requires MarketplaceAdvertising read permission.
    """
    campaign(id: ID!): Campaign

    """
    Get the wallet balance for the caller's channel.
    Requires MarketplaceAdvertising read permission.
    """
    walletBalance: Int!

    """
    Get the wallet ledger for the caller's channel.
    Requires MarketplaceAdvertising read permission.
    """
    walletLedger: [WalletLedgerEntry!]!

    """
    Get spend report for a campaign. Channel-scoped.
    Requires MarketplaceAdvertising read permission.
    """
    spendReport(campaignId: ID!): [SpendLedgerEntry!]!
  }

  extend type Mutation {
    """
    Create a campaign for the caller's channel.
    Requires MarketplaceAdvertising create permission.
    """
    createCampaign(input: CreateCampaignInput!): Campaign!

    """
    Update a campaign's mutable fields.
    Requires MarketplaceAdvertising update permission.
    """
    updateCampaign(id: ID!, input: UpdateCampaignInput!): Campaign!

    """
    Activate a draft or paused campaign.
    Requires MarketplaceAdvertising update permission.
    """
    activateCampaign(id: ID!): Campaign!

    """
    Pause an active campaign.
    Requires MarketplaceAdvertising update permission.
    """
    pauseCampaign(id: ID!): Campaign!
  }

  # ── Commission reconciliation / reporting (Gate R2) ──────────────

  type CommissionReconciliationPeriod {
    from: DateTime
    to: DateTime
  }

  type CommissionReconciliationFinancials {
    """
    Number of CommissionLedger rows found for the population.
    Distinct from reconciliation.marketplaceOrdersExpected: when
    missingCount > 0, expected > this value.
    """
    commissionLedgerOrderCount: Int!
    marketplaceGmvInPaise: Int!
    commissionEarnedInPaise: Int!
    zeroRateRowCount: Int!
    """
    commissionEarned / GMV for the population, in percent.
    null when GMV is 0 — "no GMV" and "0% commission" are different facts.
    """
    effectiveCommissionPercent: Float
  }

  type CommissionReconciliationDiagnostics {
    marketplaceOrdersExpected: Int!
    ledgerRowsFound: Int!
    """
    Marketplace-classified orders with no ledger row — the dangerous class.
    """
    missingCount: Int!
    """
    Informational: non-marketplace orders whose ref was already consumed
    by another order (Decision-6 replay arbitration worked as designed).
    """
    replayedRefCount: Int!
    """
    Stored amount ≠ floor(stored gross × stored percent / 100).
    """
    amountMismatchCount: Int!
    """
    Ledger rows whose orderId does not resolve to a marketplace-classified order.
    """
    orphanLedgerRowCount: Int!
    """
    Informational: rows whose stored percent differs from the current
    env configuration. Historical rows are never invalid.
    """
    rateDriftCount: Int!
  }

  type CommissionReconciliationReport {
    channelId: String
    period: CommissionReconciliationPeriod!
    financials: CommissionReconciliationFinancials!
    reconciliation: CommissionReconciliationDiagnostics!
  }

  extend type Query {
    """
    Read-only commission reconciliation & reporting (Gate R2).
    Channel-scoped by default; SuperAdmin may pass allChannels: true.
    Requires MarketplaceCommission read permission.
    """
    commissionReconciliation(
      from: DateTime
      to: DateTime
      allChannels: Boolean
    ): CommissionReconciliationReport!
  }
`;

