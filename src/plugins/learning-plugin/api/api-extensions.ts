import gql from 'graphql-tag';

/**
 * Shared type definitions — defined once, referenced by both admin and shop.
 * Vendure concatenates all plugin schemas; defining the same type twice
 * causes "There can be only one type named X" at schema build time.
 */
export const sharedTypes = gql`
  type LearningCourse implements Node {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    channelId: String!
    slug: String!
    title: String!
    description: String
    status: String!
    templateId: String
    createdByUserId: String
    tools: [CourseTool!]!
  }

  type LearningCourseList implements PaginatedList {
    items: [LearningCourse!]!
    totalItems: Int!
  }

  type CourseTool implements Node {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    courseId: ID!
    toolKey: String!
    order: Int!
    visibility: String!
    settings: JSON
  }

  type CourseEnrollment implements Node {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    courseId: ID!
    customerId: String!
    channelId: String!
    courseRole: String!
    status: String!
    invitedByUserId: String
    enrolledAt: DateTime
  }

  type CourseEnrollmentList implements PaginatedList {
    items: [CourseEnrollment!]!
    totalItems: Int!
  }

  type CourseAnnouncement implements Node {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    courseId: ID!
    channelId: String!
    title: String!
    body: String!
    status: String!
    publishedAt: DateTime
    authorId: String
  }

  input CreateCourseInput {
    slug: String!
    title: String!
    description: String
    templateId: ID
  }

  input UpdateCourseInput {
    title: String
    description: String
  }

  input EnrollLearnerInput {
    courseId: ID!
    customerId: ID!
    courseRole: String
  }

  input CreateAnnouncementInput {
    courseId: ID!
    title: String!
    body: String!
  }

  input UpdateAnnouncementInput {
    title: String
    body: String
  }

  input LearningCourseListOptions {
    skip: Int
    take: Int
  }
`;

export const adminApiExtensions = gql`
  ${sharedTypes}

  extend type Query {
    learningCourses(options: LearningCourseListOptions): LearningCourseList!
    learningCourse(id: ID!): LearningCourse
    courseEnrollments(courseId: ID!): CourseEnrollmentList!
    courseAnnouncements(courseId: ID!): [CourseAnnouncement!]!
  }

  extend type Mutation {
    createLearningCourse(input: CreateCourseInput!): LearningCourse!
    updateLearningCourse(id: ID!, input: UpdateCourseInput!): LearningCourse!
    publishLearningCourse(id: ID!): LearningCourse!
    closeLearningCourse(id: ID!): LearningCourse!
    archiveLearningCourse(id: ID!): LearningCourse!

    enrollLearner(input: EnrollLearnerInput!): CourseEnrollment!
    suspendLearner(courseId: ID!, customerId: ID!): CourseEnrollment!
    completeLearner(courseId: ID!, customerId: ID!): CourseEnrollment!
    withdrawLearner(courseId: ID!, customerId: ID!): CourseEnrollment!

    createCourseAnnouncement(input: CreateAnnouncementInput!): CourseAnnouncement!
    publishCourseAnnouncement(id: ID!): CourseAnnouncement!
    updateCourseAnnouncement(id: ID!, input: UpdateAnnouncementInput!): CourseAnnouncement!
  }
`;

export const shopApiExtensions = gql`
  extend type Query {
    myCourses: [LearningCourse!]!
    myCourse(slug: String!): LearningCourse
    courseAnnouncements(courseId: ID!): [CourseAnnouncement!]!
  }
`;
