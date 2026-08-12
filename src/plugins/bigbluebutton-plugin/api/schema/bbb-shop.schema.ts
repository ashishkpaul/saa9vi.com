import gql from "graphql-tag";

export const shopApiExtensions = gql`
  type BbbMeetingPublic {
    id: ID!
    title: String!
    state: String!
    recordingEnabled: Boolean!
    provisionedAt: DateTime
  }

  type BbbMeetingPublicList {
    items: [BbbMeetingPublic!]!
    totalItems: Int!
  }

  type BbbCapacityGrantPublic {
    id: ID!
    grantedMinutes: Int!
    consumedMinutes: Int!
    validFrom: DateTime!
    validUntil: DateTime!
    exhausted: Boolean!
  }

  type BbbRoomPublic {
    id: ID!
    name: String!
    state: String!
    currentMeetingId: ID
  }

  type BbbEnrollmentPublic {
    id: ID!
    roomId: ID!
    roomName: String!
    roomState: String!
    active: Boolean!
    expiresAt: DateTime
    validFrom: DateTime
    validUntil: DateTime
  }

  type BbbJoinRoomResult {
    """
    active | provisioning | failed
    """
    status: String!
    """
    Present only when status is active
    """
    joinUrl: String
  }

  type BbbScheduledSessionPublic {
    id: ID!
    title: String!
    startTime: DateTime!
    endTime: DateTime!
    status: String!
    trainerName: String
    isTrial: Boolean!
    visibility: String!
    maxAttendees: Int
    slug: String
    """
    Present only when trainer has started the session
    """
    activeMeetingId: ID
    """
    Present only when session is LIVE and meeting is provisioned
    """
    joinUrl: String
  }

  type BbbTrialRegistrationPublic {
    id: ID!
    sessionId: ID!
    sessionTitle: String
    status: String!
    registeredAt: DateTime!
    attendedAt: DateTime
  }

  # ─── Learning Dashboard (Phase 1.5, ADR-013 INV-006) ──────────────────────
  # Domain API — no Bbb* prefix. Storefront-facing contract.

  type SessionWindow {
    startsAt: DateTime!
    endsAt: DateTime!
  }

  type LearningCourse {
    id: ID!
    title: String!
    canJoin: Boolean!
    joinUrl: String
    nextSession: SessionWindow
    instructorName: String
    isTrial: Boolean!
    entitlementType: String!
    entitlementSource: String!
    """
    Server-driven CTA action (INV-008). join | none. The storefront renders
    this — it must not re-derive entitlement/eligibility from the clock.
    """
    ctaAction: String!
    """
    Server-driven CTA label (INV-008).
    """
    ctaLabel: String!
  }

  type LearningDashboard {
    courses: [LearningCourse!]!
  }

  # ─── Account Deletion Result Types (INV-013) ──────────────────────────────

  type LeaveAcademyResult {
    success: Boolean!
    message: String
  }

  type DeleteAccountResult {
    success: Boolean!
    message: String
  }

  extend type Query {
    myBbbMeetings(skip: Int, take: Int): BbbMeetingPublicList!
    myBbbCapacityGrants: [BbbCapacityGrantPublic!]!
    myBbbRooms: [BbbRoomPublic!]!
    bbbRoomStatus(id: ID!): BbbRoomPublic
    myScheduledSessions: [BbbScheduledSessionPublic!]!
    myBbbEnrollments: [BbbEnrollmentPublic!]!
    myTrialRegistrations: [BbbTrialRegistrationPublic!]!
    publicScheduledSessions: [BbbScheduledSessionPublic!]!
    """
    Student learning dashboard — aggregates entitlements, sessions, and join URLs
    into a single domain API. No Bbb* types exposed (INV-006).
    """
    myLearningDashboard: LearningDashboard!
  }

  extend type Mutation {
    bbbJoinMeeting(meetingId: ID!, participantName: String!): String!
    bbbJoinRoom(roomId: ID!, participantName: String!): BbbJoinRoomResult!
    """
    Trainer starts a scheduled session - provisions a BBB meeting
    """
    startScheduledSession(sessionId: ID!): BbbScheduledSessionPublic!
    registerForTrial(sessionId: ID!): BbbTrialRegistrationPublic!
    """
    Leave the current academy/channel. Deactivates entitlements and
    unlinks customer from channel. Uses the active channel from the
    request context — no channelId argument needed.
    """
    leaveAcademy: LeaveAcademyResult!
    """
    Permanently delete account from entire platform. Anonymizes all
    personal data. Requires current password for confirmation.
    Cannot be undone.
    """
    deleteMyAccount(password: String!): DeleteAccountResult!
  }
`;
