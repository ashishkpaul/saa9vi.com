import gql from "graphql-tag";

export const shopApiExtensions = gql`
  type BbbMeetingPublic {
    id: ID!
    title: String!
    state: String!
    recordingEnabled: Boolean!
    provisionedAt: DateTime
  }

  type BbbMeetingList {
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
    """
    Present only when trainer has started the session
    """
    activeMeetingId: ID
    """
    Present only when session is LIVE and meeting is provisioned
    """
    joinUrl: String
  }

  extend type Query {
    myBbbMeetings(skip: Int, take: Int): BbbMeetingList!
    myBbbCapacityGrants: [BbbCapacityGrantPublic!]!
    myBbbRooms: [BbbRoomPublic!]!
    bbbRoomStatus(id: ID!): BbbRoomPublic
    myScheduledSessions: [BbbScheduledSessionPublic!]!
    myBbbEnrollments: [BbbEnrollmentPublic!]!
  }

  extend type Mutation {
    bbbJoinMeeting(meetingId: ID!, participantName: String!): String!
    bbbJoinRoom(roomId: ID!, participantName: String!): BbbJoinRoomResult!
    """
    Trainer starts a scheduled session - provisions a BBB meeting
    """
    startScheduledSession(sessionId: ID!): BbbScheduledSessionPublic!
  }
`;
