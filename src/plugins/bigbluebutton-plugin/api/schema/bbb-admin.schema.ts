import gql from "graphql-tag";

export const adminApiExtensions = gql`
  type BbbServer {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    name: String!
    apiUrl: String!
    enabled: Boolean!
    healthy: Boolean!
    currentLoad: Int!
    maxLoad: Int!
    capacity: Int!
    lastHealthCheckAt: DateTime
  }

  type BbbOrganization {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    channelId: ID!
    ownerUserId: ID
    slug: String!
    name: String!
    concurrentMeetingLimit: Int!
    maxParticipantsPerMeeting: Int!
    recordingEnabled: Boolean!
    suspended: Boolean!
  }

  type BbbMeeting {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    title: String!
    state: String!
    bbbMeetingId: String
    recordingEnabled: Boolean!
    provisionedAt: DateTime
    completedAt: DateTime
    failureReason: String
    retryCount: Int!
    billingCapped: Boolean!
    billingCapReason: String
    lastReconciledAt: DateTime
    reconciliationAttemptCount: Int!
    organization: BbbOrganization!
  }

  type BbbMeetingList {
    items: [BbbMeeting!]!
    totalItems: Int!
  }

  type BbbCapacityGrant {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    orderId: ID
    orderLineId: ID
    productVariantId: ID
    grantedMinutes: Int!
    consumedMinutes: Int!
    validFrom: DateTime!
    validUntil: DateTime!
    exhausted: Boolean!
  }

  type BbbCapacityGrantList {
    items: [BbbCapacityGrant!]!
    totalItems: Int!
  }

  # ─── Room types ──────────────────────────────────────────────────────────────

  """
  A persistent UX abstraction for a recurring meeting space.
  Rooms are long-lived; meetings are ephemeral runtime records created on-demand.
  """
  type BbbRoom {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    organizationId: ID!
    name: String!
    description: String
    slug: String
    createdByCustomerId: ID
    recordingEnabled: Boolean!
    maxParticipants: Int
    state: String!
    currentMeetingId: ID
    retryCount: Int!
    lastProvisionRequestedAt: DateTime
  }

  # ─── Product Access (enrollment mapping) ────────────────────────────────────

  """
  Maps a product variant to a BBB room so that purchasing the variant
  automatically enrolls the buyer into the room via fulfillment.
  """
  type BbbProductAccess {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    productVariantId: ID!
    room: BbbRoom!
    accessDays: Int
  }

  type BbbEnrollment {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    roomId: ID!
    customerId: ID!
    customerName: String
    customerEmail: String
    orderId: ID
    active: Boolean!
    expiresAt: DateTime
    validFrom: DateTime
    validUntil: DateTime
    source: String!
  }

  type BbbEnrollmentList {
    items: [BbbEnrollment!]!
    totalItems: Int!
  }

  # ─── Entitlement types ────────────────────────────────────────────────────────

  type BbbEntitlement {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    customerId: ID!
    type: String!
    resourceId: ID!
    source: String!
    validFrom: DateTime
    validUntil: DateTime
  }

  type BbbEntitlementList {
    items: [BbbEntitlement!]!
    totalItems: Int!
  }

  # ─── Member types (M4) ──────────────────────────────────────────────────────

  # ─── Organization Membership types (FEAT-001 / BUG-018) ─────────────────────

  """
  Internal staff membership for an organization. Enables Archetype B (Internal
  Staff Meeting flow) — staff can join internal rooms (productVariantId = null)
  without purchasing.
  """
  type BbbOrganizationMembership {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    organizationId: ID!
    customerId: ID!
    channelId: ID!
    role: String!
    isActive: Boolean!
  }

  type BbbOrganizationMember {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    organizationId: ID!
    customerId: ID!
    customerName: String
    customerEmail: String
    role: String!
    active: Boolean!
    keycloakSub: String
  }

  # ─── Scheduled Session types ─────────────────────────────────────────────────

  type BbbTrialRegistration {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    scheduledSessionId: ID!
    customerId: ID!
    status: String!
    registeredAt: DateTime!
    attendedAt: DateTime
  }

  type BbbScheduledSession {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    title: String!
    startTime: DateTime!
    endTime: DateTime!
    status: String!
    organization: BbbOrganization!
    trainerId: ID!
    activeMeetingId: ID
    productVariantId: ID
    isTrial: Boolean!
    visibility: String!
    maxAttendees: Int
    subjectTags: [String!]
  }


  type BbbServerList {
    items: [BbbServer!]!
    totalItems: Int!
  }

  type BbbOrganizationList {
    items: [BbbOrganization!]!
    totalItems: Int!
  }

  type BbbRoomList {
    items: [BbbRoom!]!
    totalItems: Int!
  }

  type BbbOrganizationMemberList {
    items: [BbbOrganizationMember!]!
    totalItems: Int!
  }

  # ─── Queries ─────────────────────────────────────────────────────────────────

  extend type Query {
    bbbServers(options: BbbServerListOptions): BbbServerList!
    bbbServer(id: ID!): BbbServer
    bbbOrganizations(options: BbbOrganizationListOptions): BbbOrganizationList!
    poolCapacityDashboard: PoolCapacityDashboard!
    bbbOrganization(id: ID!): BbbOrganization
    bbbMeetings(
      organizationId: ID
      options: BbbMeetingListOptions
    ): BbbMeetingList!
    bbbMeeting(id: ID!): BbbMeeting
    bbbCapacityGrants(organizationId: ID!, options: BbbCapacityGrantListOptions): BbbCapacityGrantList!
    bbbModeratorJoinUrl(meetingId: ID!, moderatorName: String!): String!
    bbbRooms(organizationId: ID!, options: BbbRoomListOptions): BbbRoomList!
    bbbRoom(id: ID!): BbbRoom
    bbbOrganizationMembers(
      organizationId: ID!
      options: BbbOrganizationMemberListOptions
    ): BbbOrganizationMemberList!
    bbbOrganizationMember(id: ID!): BbbOrganizationMember
    bbbProductAccessByRoom(roomId: ID!): [BbbProductAccess!]!
    bbbEnrollmentsByRoom(
      roomId: ID!
      options: BbbEnrollmentListOptions
    ): BbbEnrollmentList!
    bbbProductVariantSearch(term: String!): [BbbProductVariantResult!]!
    bbbScheduledSessions(organizationId: ID!): [BbbScheduledSession!]!
    bbbScheduledSession(id: ID!): BbbScheduledSession
    bbbTrialRegistrationsBySession(sessionId: ID!): [BbbTrialRegistration!]!
    bbbTrialRegistrationsByOrganization(organizationId: ID!): [BbbTrialRegistration!]!
    bbbEntitlements(options: BbbEntitlementListOptions): BbbEntitlementList!
    """
    List all organization memberships for a given organization (FEAT-001).
    """
    bbbOrgMemberships(organizationId: ID!): [BbbOrganizationMembership!]!
  }

  # ─── Mutations ───────────────────────────────────────────────────────────────

  extend type Mutation {
    """
    Create an organization membership (FEAT-001).
    """
    createBbbOrgMembership(input: CreateBbbOrgMembershipInput!): BbbOrganizationMembership!
    """
    Update an organization membership (FEAT-001).
    """
    updateBbbOrgMembership(id: ID!, input: UpdateBbbOrgMembershipInput!): BbbOrganizationMembership!
    """
    Remove an organization membership (FEAT-001).
    """
    removeBbbOrgMembership(id: ID!): Boolean!
    createBbbServer(input: CreateBbbServerInput!): BbbServer!
    updateBbbServer(id: ID!, input: UpdateBbbServerInput!): BbbServer!
    createBbbOrganization(input: CreateBbbOrganizationInput!): BbbOrganization!
    updateBbbOrganization(
      id: ID!
      input: UpdateBbbOrganizationInput!
    ): BbbOrganization!
    createBbbMeeting(input: CreateBbbMeetingInput!): BbbMeeting!
    retryBbbMeeting(failedMeetingId: ID!): BbbMeeting!
    updateBbbMeeting(id: ID!, input: UpdateBbbMeetingInput!): BbbMeeting!
    deleteBbbMeeting(id: ID!): Boolean!
    endBbbMeeting(id: ID!): BbbMeeting!
    deleteBbbServer(id: ID!): Boolean!
    deleteBbbOrganization(id: ID!): Boolean!
    createBbbCapacityGrant(
      input: CreateBbbCapacityGrantInput!
    ): BbbCapacityGrant!
    createBbbRoom(input: CreateBbbRoomInput!): BbbRoom!
    updateBbbRoom(id: ID!, input: UpdateBbbRoomInput!): BbbRoom!
    deleteBbbRoom(id: ID!): Boolean!
    resetBbbRoom(id: ID!): BbbRoom!
    createBbbScheduledSession(
      input: CreateBbbScheduledSessionInput!
    ): BbbScheduledSession!
    updateBbbScheduledSession(
      id: ID!
      input: UpdateBbbScheduledSessionInput!
    ): BbbScheduledSession!
    cancelBbbScheduledSession(id: ID!): BbbScheduledSession!
    updateBbbTrialRegistrationStatus(id: ID!, status: String!): BbbTrialRegistration!
    addBbbMember(input: AddBbbMemberInput!): BbbOrganizationMember!
    updateBbbMember(
      id: ID!
      input: UpdateBbbMemberInput!
    ): BbbOrganizationMember!
    removeBbbMember(id: ID!): BbbOrganizationMember!
    createBbbProductAccess(
      input: CreateBbbProductAccessInput!
    ): BbbProductAccess!
    deleteBbbProductAccess(id: ID!): Boolean!
    deactivateBbbEnrollment(id: ID!): BbbEnrollment!
    createBbbEnrollment(input: CreateBbbEnrollmentInput!): BbbEnrollment!
    """
    Converts a trial attendee into a fully enrolled learner by granting room access.
    Returns a BbbEntitlement of type 'bbb_room' for the given room.
    """
    convertTrialToEnrollment(registrationId: ID!, roomId: ID!, accessDays: Int): BbbEntitlement!
    createBbbEntitlement(input: CreateBbbEntitlementInput!): BbbEntitlement!
    deleteBbbEntitlement(id: ID!): Boolean!
  }

  # ─── Input Types ─────────────────────────────────────────────────────────────

  input CreateBbbServerInput {
    name: String!
    apiUrl: String!
    apiSecret: String!
    maxLoad: Int
    capacity: Int
  }

  input UpdateBbbServerInput {
    name: String
    apiUrl: String
    apiSecret: String
    maxLoad: Int
    capacity: Int
    enabled: Boolean
  }

  input CreateBbbOrganizationInput {
    channelId: ID!
    slug: String!
    name: String!
    concurrentMeetingLimit: Int
    maxParticipantsPerMeeting: Int
    recordingEnabled: Boolean
  }

  input UpdateBbbOrganizationInput {
    name: String
    concurrentMeetingLimit: Int
    maxParticipantsPerMeeting: Int
    recordingEnabled: Boolean
    suspended: Boolean
  }

  input CreateBbbMeetingInput {
    organizationId: ID!
    title: String!
    recordingEnabled: Boolean
  }

  input UpdateBbbMeetingInput {
    title: String
    recordingEnabled: Boolean
  }

  input AddBbbMemberInput {
    organizationId: ID!
    customerId: ID!
    role: String!
  }

  input UpdateBbbMemberInput {
    role: String
    active: Boolean
  }

  input BbbServerListOptions {
    skip: Int
    take: Int
  }

  input BbbOrganizationListOptions {
    skip: Int
    take: Int
  }

  input BbbRoomListOptions {
    skip: Int
    take: Int
  }

  input BbbOrganizationMemberListOptions {
    skip: Int
    take: Int
  }

  input BbbMeetingListOptions {
    skip: Int
    take: Int
  }

  input BbbCapacityGrantListOptions {
    skip: Int
    take: Int
  }

  input CreateBbbCapacityGrantInput {
    organizationId: ID!
    grantedMinutes: Int!
    validFrom: String
    validUntil: String
  }

  input CreateBbbRoomInput {
    organizationId: ID!
    name: String!
    description: String
    slug: String
    recordingEnabled: Boolean
    maxParticipants: Int
  }

  input UpdateBbbRoomInput {
    name: String
    description: String
    recordingEnabled: Boolean
    maxParticipants: Int
  }

  input CreateBbbScheduledSessionInput {
    organizationId: ID!
    title: String!
    startTime: String!
    endTime: String!
    trainerId: ID!
    subjectTags: [String!]
  }

  input UpdateBbbScheduledSessionInput {
    title: String
    startTime: String
    endTime: String
    subjectTags: [String!]
    visibility: String
  }

  input CreateBbbProductAccessInput {
    roomId: ID!
    productVariantId: ID!
    accessDays: Int
  }

  input CreateBbbEnrollmentInput {
    roomId: ID!
    customerId: ID!
    accessDays: Int
    reason: String
  }

  type BbbProductVariantResult {
    id: ID!
    name: String!
    sku: String!
    productName: String!
  }

  input BbbEnrollmentListOptions {
    skip: Int
    take: Int
  }

  input BbbEntitlementListOptions {
    skip: Int
    take: Int
  }

  input CreateBbbEntitlementInput {
    customerId: ID!
    type: String!
    resourceId: ID!
    source: String!
    validFrom: String
    validUntil: String
  }

  # ─── Capacity Intelligence Types (ADR v1.7 §6A) ──────────────────────────────

  type PoolCapacityDashboard {
    liveHealth: ServerPoolHealth!
    forecast: [LoadForecastSlot!]!
    recommendation: CapacityRecommendation!
    historicalPeak: HistoricalPeakStats!
  }

  type ServerPoolHealth {
    servers: [ServerHealth!]!
    totalServers: Int!
    activeServers: Int!
    totalVirtualLoad: Float!
    totalCapacity: Int!
    poolLoadPercent: Float!
    activeAttendees: Int!
    activeMeetings: Int!
    safeHeadroom: Float!
  }

  type ServerHealth {
    serverId: ID!
    serverName: String!
    status: String!
    currentLoad: Int!
    loadPercent: Float!
    activeMeetings: Int!
    activeParticipants: Int!
    isOverloaded: Boolean!
  }

  type LoadForecastSlot {
    windowStart: DateTime!
    windowEnd: DateTime!
    expectedSessions: Int!
    expectedAttendees: Int!
    expectedVirtualLoad: Float!
    projectedLoadPercent: Float!
    riskLevel: String!
  }

  type CapacityRecommendation {
    currentServers: Int!
    currentCapacity: Int!
    peakForecastLoad: Float!
    peakForecastAt: DateTime!
    peakForecastPercent: Float!
    serversNeeded: Int!
    urgency: String!
    reasoning: String!
  }

  type HistoricalPeakStats {
    last7DaysPeakAttendees: Int!
    last7DaysPeakLoad: Float!
    last7DaysPeakAt: DateTime!
    avgDailyAttendeeMinutes: Float!
  }

  # ─── Organization Membership Inputs (FEAT-001) ──────────────────────────────

  input CreateBbbOrgMembershipInput {
    organizationId: ID!
    customerId: ID!
    channelId: ID!
    role: String!
  }

  input UpdateBbbOrgMembershipInput {
    role: String
    isActive: Boolean
  }

  # ─── Platform Capacity Policy (ADR-031) ─────────────────────────────────────
  # Portal Admin-owned BBB infrastructure limits. One row per SubscriptionPlan
  # tier plus a platform-default row (subscriptionPlanId null).

  type BbbPlatformCapacityPolicy {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    defaultRoomCapacity: Int!
    maxRoomCapacity: Int!
    maxConcurrentParticipants: Int!
    "Null = platform-default policy for tenants without a matching plan."
    subscriptionPlanId: ID
  }

  input PlatformCapacityPolicyInput {
    "Null/omitted targets the platform-default policy row."
    subscriptionPlanId: ID
    defaultRoomCapacity: Int!
    maxRoomCapacity: Int!
    maxConcurrentParticipants: Int!
  }

  extend type Query {
    """
    All platform capacity policy rows (ADR-031). Portal infrastructure only.
    """
    platformCapacityPolicies: [BbbPlatformCapacityPolicy!]!

    """
    The effective capacity policy for a channel (plan-matched → default → fallback).
    Portal infrastructure only.
    """
    effectiveCapacityPolicy(channelId: ID!): EffectiveCapacityPolicy!
  }

  type EffectiveCapacityPolicy {
    defaultRoomCapacity: Int!
    maxRoomCapacity: Int!
    maxConcurrentParticipants: Int!
    source: String!
  }

  extend type Mutation {
    """
    Create or update the policy row for a plan tier (or the platform default).
    Portal infrastructure only. Enabling adoption switches room provisioning
    and org cache sync to policy-driven values.
    """
    upsertPlatformCapacityPolicy(input: PlatformCapacityPolicyInput!): BbbPlatformCapacityPolicy!

    "Delete a policy row by id. Portal infrastructure only."
    deletePlatformCapacityPolicy(id: ID!): Boolean!
  }
`;
