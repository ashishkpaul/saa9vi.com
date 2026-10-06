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
    """
    Simultaneous live meetings this organization may run. Sole ENFORCEMENT
    surface for concurrency (ADR-031) — resolved from the plan's
    BbbPlatformCapacityPolicy.maxConcurrentMeetings and cached here, never
    resolved at enforcement time. Free Basic is frozen at 1; paid tiers are
    Portal-Admin-set. Optional on input: omitting it preserves the current
    value.
    """
    concurrentMeetingLimit: Int!
    maxParticipantsPerMeeting: Int!
    maxSessionsPerOrg: Int!
    recordingEnabled: Boolean!
    suspended: Boolean!
    """
    'grant' or 'metered' (ADR-047). Writable ONLY through the platform-gated
    setBbbOrganizationBilling — never through updateBbbOrganization.
    """
    billingMode: String!
    """
    Per-org learner-hour rate in paise; null → platform default (plugin option,
    else the clearly marked placeholder). Platform-writable only.
    """
    ratePaisePerLearnerHour: Int
    "Postpaid ceiling in paise; null = unlimited. Platform-writable only."
    monthlySpendLimitPaise: Int
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
    """
    W5 audit trail (new rows only, no backfill): user whose request created or
    launched this meeting. Null = system origin (queue provisioning, auto
    room start, webhook).
    """
    startedByUserId: ID
    """
    W5 audit trail (new rows only, no backfill): user whose request performed
    the completion that ended this meeting. Null = system completion
    (webhook / reconciliation).
    """
    endedByUserId: ID
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
    """
    Source discriminator: order | subscription | manual | internal_overhead
    (BUG-044: 'manual' = Admin createBbbCapacityGrant override).
    """
    sourceType: String!
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
    """
    Phase 5.4 — DISTINCT customers with an active enrollment OR a valid
    bbb_room entitlement for this room. Computed on the room list and
    single-room reads (batched — no N+1) from the shared INV-027 validity
    windows; null on results that do not compute it (room mutations, nested
    relations) rather than a misleading 0.
    """
    studentCount: Int
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
    """Room this session belongs to. null for legacy sessions created before the room-centric model (ADR-047/D5)."""
    roomId: ID
  }

  """
  A reusable template for generating recurring/series sessions.
  Each generated session starts as DRAFT and must be published individually.
  """
  type BbbSessionTemplate {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    organizationId: ID!
    name: String!
    defaultTitle: String!
    defaultTrainerId: ID
    durationMinutes: Int!
    defaultSubjectTags: [String!]
    defaultVisibility: String!
    productVariantId: ID
  }


  type BbbServerList {
    items: [BbbServer!]!
    totalItems: Int!
  }

  type BbbOrganizationList {
    items: [BbbOrganization!]!
    totalItems: Int!
  }

  type BbbRoomStartResult {
    """'active' | 'starting' | 'failed' | 'unavailable' (see bbbStartRoom)."""
    status: String!
    """A **moderator** join URL — present only when status = 'active'."""
    joinUrl: String
    currentMeetingId: ID
    """The room's state when the call returned (drives the card badge)."""
    roomState: String!
    """
    Tenant-safe reason when status = 'failed' or 'unavailable' (A22/S4.2):
    suspended orgs and spend-cap orgs get "Your account is paused — contact
    support". Never a raw internal failureReason.
    """
    message: String
  }

  type BbbRoomList {
    items: [BbbRoom!]!
    totalItems: Int!
  }

  type BbbOrganizationMemberList {
    items: [BbbOrganizationMember!]!
    totalItems: Int!
  }

  type BbbReconciliationResult {
    provisioningFixed: Int!
    activeReconciled: Int!
    roomsReconciled: Int!
    billingRecovered: Int!
    meteredRecovered: Int!
  }

  # ─── Queries ─────────────────────────────────────────────────────────────────

  extend type Query {
    bbbServers(options: BbbServerListOptions): BbbServerList!
    bbbServer(id: ID!): BbbServer
    bbbOrganizations(options: BbbOrganizationListOptions): BbbOrganizationList!
    poolCapacityDashboard: PoolCapacityDashboard!
    bbbOrganization(id: ID!): BbbOrganization
    """
    The organization bound to the active channel (Channel = Tenant, INV-001).
    Resolved server-side from the request context channelId — the same value
    BbbChannelAccessService enforces — so tenant screens never need a
    client-side organization selector and can never display another tenant's
    organization. Returns null when the active channel has no organization.
    Platform-tier cross-tenant browsing uses bbbOrganizations.
    """
    bbbMyOrganization: BbbOrganization
    bbbMeetings(
      organizationId: ID
      roomId: ID
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
    List all session templates for an organization.
    """
    bbbSessionTemplates(organizationId: ID!): [BbbSessionTemplate!]!
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
    """
    On-demand BBB reconciliation (SuperAdmin only). Runs the same five passes
    as the scheduled bbb-reconciliation task (stuck provisioning, active
    meetings, rooms, grant billing, metered billing) and returns per-pass
    counts. Use instead of raw SQL when meetings/rooms drift from the BBB
    server.
    """
    runBbbReconciliation: BbbReconciliationResult!
    deleteBbbServer(id: ID!): Boolean!
    deleteBbbOrganization(id: ID!): Boolean!
    createBbbCapacityGrant(
      input: CreateBbbCapacityGrantInput!
    ): BbbCapacityGrant!
    createBbbRoom(input: CreateBbbRoomInput!): BbbRoom!
    updateBbbRoom(id: ID!, input: UpdateBbbRoomInput!): BbbRoom!
    deleteBbbRoom(id: ID!): Boolean!
    resetBbbRoom(id: ID!): BbbRoom!
    """
    A22 (Phase 5) — the dashboard's "Start class" action: provisions the room if
    needed and returns a moderator join URL.

    Authorizes BEFORE provisioning (INV-027): the room must belong to the caller's
    channel, and a caller whose linked customer is not a moderator-capable member
    of the owning organization is refused with no meeting created. Status is
    'active' (joinUrl present), 'starting' (provisioning in flight — call again,
    idempotent), 'failed' (room Failed beyond its retry budget; reset it) or
    'unavailable' (org suspended or spend-capped; message is tenant-safe).
    moderatorName defaults to the caller's administrator name, then the room
    name. waitMs (max 20000) bounds how long the call waits for the room to go
    live before answering 'starting'.
    """
    bbbStartRoom(
      roomId: ID!
      moderatorName: String
      waitMs: Int
    ): BbbRoomStartResult!
    createBbbScheduledSession(
      input: CreateBbbScheduledSessionInput!
    ): BbbScheduledSession!
    updateBbbScheduledSession(
      id: ID!
      input: UpdateBbbScheduledSessionInput!
    ): BbbScheduledSession!
    cancelBbbScheduledSession(id: ID!): BbbScheduledSession!
    """
    Transition a DRAFT session to SCHEDULED, making it visible and startable.
    Only DRAFT sessions can be published.
    """
    publishBbbScheduledSession(id: ID!): BbbScheduledSession!
    """
    Create a reusable session template for generating recurring/series sessions.
    """
    createBbbSessionTemplate(input: CreateBbbSessionTemplateInput!): BbbSessionTemplate!
    """
    Delete a session template (does not affect already-generated sessions).
    """
    deleteBbbSessionTemplate(id: ID!): Boolean!
    """
    Generate multiple DRAFT sessions from a template by supplying start times.
    endTime = startTime + template.durationMinutes for each occurrence.
    All sessions start as DRAFT and must be published individually.
    """
    createSessionsFromTemplate(templateId: ID!, startTimes: [String!]!): [BbbScheduledSession!]!
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
    """
    Maximum non-terminal sessions allowed for this org. 0 = unlimited.
    Only platform operators (BbbManageOrganizationsPermission) can set this.
    """
    maxSessionsPerOrg: Int
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
    isTrial: Boolean
    visibility: String
    """Optional room linkage; the room must belong to the same organization (ADR-047/D5)."""
    roomId: ID
  }

  input UpdateBbbScheduledSessionInput {
    title: String
    startTime: String
    endTime: String
    subjectTags: [String!]
    visibility: String
    isTrial: Boolean
    """Optional room linkage; pass null to detach (room must belong to the same organization)."""
    roomId: ID
  }

  input CreateBbbSessionTemplateInput {
    organizationId: ID!
    name: String!
    defaultTitle: String!
    defaultTrainerId: ID
    durationMinutes: Int
    defaultSubjectTags: [String!]
    defaultVisibility: String
    productVariantId: ID
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
    """
      Exact-match customerId probe used by the entitlements screen's
      Filter by Customer ID box. This custom list input does not inherit
      Vendure's generic filter argument, so the field is declared here — the
      previous client-side filter key was rejected by variable coercion (the
      whole query failed and the screen rendered the failure as an empty list).
    """
    filter: BbbEntitlementFilter
  }

  input BbbEntitlementFilter {
    customerId: String
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
    """
    Simultaneous live meetings the plan grants. Denormalized onto the
    organization as BbbOrganization.concurrentMeetingLimit, which remains the
    enforcement surface. Free Basic (tier 1) is frozen at 1; paid tiers are
    Portal-Admin-set. Column default 5.
    """
    maxConcurrentMeetings: Int!
    "Null = platform-default policy for tenants without a matching plan."
    subscriptionPlanId: ID
  }

  input PlatformCapacityPolicyInput {
    "Null/omitted targets the platform-default policy row."
    subscriptionPlanId: ID
    defaultRoomCapacity: Int!
    maxRoomCapacity: Int!
    maxConcurrentParticipants: Int!
    """
    Omit to keep the stored value (default 5 on a fresh row). Deliberately
    optional so existing callers that predate plan-derived concurrency keep
    working unchanged.
    """
    maxConcurrentMeetings: Int
  }

  # ─── Attendance Analytics (3D.3d) ────────────────────────────────────────────

  type SessionAttendanceAdmin {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    channelId: ID!
    scheduledSessionId: ID!
    meetingId: ID
    customerId: ID!
    "Vendure Customer display name (resolved from customer relation)"
    customerName: String
    "Vendure Customer email (resolved from customer relation)"
    customerEmail: String
    joinedAt: DateTime
    leftAt: DateTime
    totalDurationSeconds: Int!
    cyclesCount: Int!
    attendanceStatus: String!
    source: String!
    lastEventAt: DateTime
    lastProcessedWebhookEventId: ID
  }

  type SessionAttendanceSummary {
    sessionId: ID!
    registered: Int!
    attended: Int!
    noShow: Int!
    attendanceRate: Float!
    averageDurationSeconds: Float!
    completionRate: Float!
  }

  type ChannelAttendanceSummary {
    from: DateTime!
    to: DateTime!
    totalSessions: Int!
    totalRegistered: Int!
    totalAttended: Int!
    totalNoShow: Int!
    attendanceRate: Float!
    averageDurationSeconds: Float!
    completionRate: Float!
  }

  extend type Query {
    """
    All platform capacity policy rows (ADR-031). Portal infrastructure only.
    """
    platformCapacityPolicies: [BbbPlatformCapacityPolicy!]!

    # ─── Attendance Analytics (3D.3d) ──────────────────────────────────────────

    """
    Per-student attendance facts for a scheduled session (Tenant Admin, channel-scoped).
    Requires BbbManageSessionsPermission.
    """
    scheduledSessionAttendance(sessionId: ID!): [SessionAttendanceAdmin!]!

    """
    Attendance summary for a single session (Tenant Admin, channel-scoped).
    Requires BbbManageSessionsPermission.
    """
    scheduledSessionAttendanceSummary(sessionId: ID!): SessionAttendanceSummary!

    """
    Channel-wide attendance summary for an operational reporting window.
    Requires BbbManageSessionsPermission. Filters on lastEventAt (session end time).
    """
    channelAttendanceSummary(from: DateTime!, to: DateTime!): ChannelAttendanceSummary!

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
    """
    Simultaneous live meetings granted by this resolution. Mirrored onto
    BbbOrganization.concurrentMeetingLimit — but only when 'source' is
    plan-derived ('plan' or 'channel-override'); a 'platform-default' or
    'fallback' answer never overwrites an Admin-set organization value.
    """
    maxConcurrentMeetings: Int!
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

  # ─── Metered billing reads + platform billing control (ADR-047 Phase 4) ──

  """
  Tenant monthly billing summary. The organization is derived from the caller's
  channel (D3) — there is no organizationId argument. totalChargePaise is
  computed once per month via computeMonthChargePaise (D2, half-up to the paisa).
  """
  type BbbBillingSummary {
    month: String!
    """
    Effective rate for display: per-org ratePaisePerLearnerHour override, else
    the defaultRatePaisePerLearnerHour plugin option, else the clearly marked
    placeholder default.
    """
    ratePaisePerHour: Int!
    totalLearnerMinutes: Int!
    totalChargePaise: Int!
    "null = unlimited."
    spendLimitPaise: Int
    spendLimitReached: Boolean!
    byRoom: [BbbBillingRoomRow!]!
  }

  type BbbBillingRoomRow {
    roomId: ID
    roomName: String
    learnerMinutes: Int!
    chargePaise: Int!
  }

  """
  One billed meeting of a month, joined to its meeting row for title/recording.
  recordingUrl is whatever the rap-publish-ended webhook stored — null until BBB
  reports a playback URL (never invented).
  """
  type BbbMeteredMeeting {
    id: ID!
    title: String!
    roomId: ID
    roomName: String
    startedAt: DateTime!
    completedAt: DateTime!
    peakLearners: Int!
    peakModerators: Int!
    learnerMinutes: Int!
    chargePaise: Int!
    billingCapped: Boolean!
    recordingUrl: String
  }

  type BbbMeteredMeetingList {
    items: [BbbMeteredMeeting!]!
    totalItems: Int!
  }

  "Platform-wide roll-up across tenants (platform tier only)."
  type BbbPlatformBillingSummary {
    month: String!
    totalLearnerMinutes: Int!
    totalChargePaise: Int!
    byOrganization: [BbbPlatformBillingOrganizationRow!]!
  }

  type BbbPlatformBillingOrganizationRow {
    organizationId: ID!
    organizationName: String!
    learnerMinutes: Int!
    chargePaise: Int!
  }

  extend type Query {
    """
    Tenant billing summary for a month (YYYY-MM; defaults to the current UTC
    month). Organization from ctx.channelId — D3: no organizationId argument.
    """
    bbbBillingSummary(month: String): BbbBillingSummary!
    """
    Tenant billed meeting history for a month with per-meeting charge shares
    and recordingUrl. Organization from ctx.channelId — D3: no organizationId.
    """
    bbbMeteredMeetings(month: String, skip: Int, take: Int): BbbMeteredMeetingList!
    """
    Platform-wide metered roll-up across all tenants. Platform tier only
    (BBBAdmin / BBBPlatformInfrastructure) — never a tenant-held permission.
    """
    bbbPlatformBillingSummary(month: String): BbbPlatformBillingSummary!
  }

  extend type Mutation {
    """
    The ONLY way to change billingMode / ratePaisePerLearnerHour /
    monthlySpendLimitPaise / suspended (ADR-047 H1) — those fields never appear
    on updateBbbOrganization. Platform tier only (BBBAdmin /
    BBBPlatformInfrastructure). Full replace: rate null clears the per-org
    override back to the platform default; monthlySpendLimitPaise null clears
    the ceiling to unlimited.
    """
    setBbbOrganizationBilling(
      organizationId: ID!
      billingMode: String!
      ratePaisePerLearnerHour: Int
      monthlySpendLimitPaise: Int
      suspended: Boolean!
    ): BbbOrganization!
  }
`;
