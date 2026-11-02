import gql from 'graphql-tag';

/**
 * Admin API type definitions and extensions for LearningPlugin.
 * Shared types are defined here (admin schema) and separately in
 * shopApiExtensions — Vendure builds Admin and Shop schemas independently.
 */
export const adminApiExtensions = gql`
  type LearningCourseAdmin implements Node {
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
    tools: [CourseToolAdmin!]!
    enrollments: [CourseEnrollmentAdmin!]!
  }

  type LearningCourseAdminList implements PaginatedList {
    items: [LearningCourseAdmin!]!
    totalItems: Int!
  }

  type CourseToolAdmin implements Node {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    courseId: ID!
    toolKey: String!
    order: Int!
    visibility: String!
    settings: JSON
  }

  type CourseEnrollmentAdmin implements Node {
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

  type CourseEnrollmentAdminList implements PaginatedList {
    items: [CourseEnrollmentAdmin!]!
    totalItems: Int!
  }

  type CourseAnnouncementAdmin implements Node {
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

  input LearningCreateCourseInput {
    slug: String!
    title: String!
    description: String
    templateId: ID
  }

  input LearningUpdateCourseInput {
    title: String
    description: String
  }

  input LearningEnrollLearnerInput {
    courseId: ID!
    customerId: ID!
    courseRole: String
  }

  input LearningCreateAnnouncementInput {
    courseId: ID!
    title: String!
    body: String!
  }

  input LearningUpdateAnnouncementInput {
    title: String
    body: String
  }

  input LearningCourseAdminListOptions {
    skip: Int
    take: Int
  }

  extend type Query {
    learningCourses(options: LearningCourseAdminListOptions): LearningCourseAdminList!
    learningCourse(id: ID!): LearningCourseAdmin
    courseEnrollments(courseId: ID!): CourseEnrollmentAdminList!
    courseAnnouncements(courseId: ID!): [CourseAnnouncementAdmin!]!
  }

  extend type Mutation {
    createLearningCourse(input: LearningCreateCourseInput!): LearningCourseAdmin!
    updateLearningCourse(id: ID!, input: LearningUpdateCourseInput!): LearningCourseAdmin!
    publishLearningCourse(id: ID!): LearningCourseAdmin!
    closeLearningCourse(id: ID!): LearningCourseAdmin!
    archiveLearningCourse(id: ID!): LearningCourseAdmin!

    enrollLearner(input: LearningEnrollLearnerInput!): CourseEnrollmentAdmin!
    suspendLearner(courseId: ID!, customerId: ID!): CourseEnrollmentAdmin!
    completeLearner(courseId: ID!, customerId: ID!): CourseEnrollmentAdmin!
    withdrawLearner(courseId: ID!, customerId: ID!): CourseEnrollmentAdmin!

    createCourseAnnouncement(input: LearningCreateAnnouncementInput!): CourseAnnouncementAdmin!
    publishCourseAnnouncement(id: ID!): CourseAnnouncementAdmin!
    updateCourseAnnouncement(id: ID!, input: LearningUpdateAnnouncementInput!): CourseAnnouncementAdmin!
  }
`;

/**
 * Shop API extensions for LearningPlugin.
 *
 * IMPORTANT: BBB plugin already defines `LearningCourse` in its Shop schema
 * for myLearningDashboard. These types use `CoursePage` / `CoursePageTool` /
 * `CoursePageAnnouncement` prefixes to avoid the duplicate-type conflict.
 * Both schemas are built independently by Vendure and cannot share types.
 */
export const shopApiExtensions = gql`
  type CoursePage implements Node {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    slug: String!
    title: String!
    description: String
    status: String!
    tools: [CoursePageTool!]!
  }

  type CoursePageTool implements Node {
    id: ID!
    toolKey: String!
    order: Int!
    visibility: String!
  }

  type CoursePageAnnouncement implements Node {
    id: ID!
    title: String!
    body: String!
    publishedAt: DateTime
    authorId: String
  }

  extend type Query {
    myCoursePages: [CoursePage!]!
    myCoursePage(slug: String!): CoursePage
    coursePageAnnouncements(courseId: ID!): [CoursePageAnnouncement!]!
  }
`;
