import gql from 'graphql-tag';

const sharedTypeExtensions = gql`
    type TenantProfile implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: String!
        businessName: String!
        tagline: String
        logoAssetId: ID
        logoAsset: Asset
        timezone: String!
        contactEmail: String!
        customDomain: String
        onboardingComplete: Boolean!
    }

    type InstructorProfile implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: String!
        slug: String!
        fullName: String!
        bio: String
        photoAssetId: ID
        photoAsset: Asset
        customer: Customer
        createdBy: Customer
        credentials: String
        expertiseAreas: [String!]!
        displayOrder: Int!
        isActive: Boolean!
        isPublic: Boolean!
    }

    type InstructorProfileList implements PaginatedList {
        items: [InstructorProfile!]!
        totalItems: Int!
    }

    input InstructorProfileListOptions {
        skip: Int
        take: Int
    }

    type MediaResource implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: String!
        ownerType: String!
        ownerId: String!
        type: String!
        url: String!
        title: String!
        thumbnailAssetId: ID
        thumbnailAsset: Asset
        displayOrder: Int!
        isFeatured: Boolean!
        isActive: Boolean!
    }

    type MediaResourceList implements PaginatedList {
        items: [MediaResource!]!
        totalItems: Int!
    }

    input MediaResourceListOptions {
        skip: Int
        take: Int
        ownerType: String
        ownerId: String
    }
`;

export const adminApiExtensions = gql`
    ${sharedTypeExtensions}

    input CreateTenantProfileInput {
        channelId: String
        businessName: String!
        tagline: String
        logoAssetId: ID
        timezone: String
        contactEmail: String!
    }

    input UpdateTenantProfileInput {
        channelId: String!
        businessName: String
        tagline: String
        logoAssetId: ID
        timezone: String
        contactEmail: String
        customDomain: String
        onboardingComplete: Boolean
    }

    input CreateInstructorProfileInput {
        customerId: ID!
        slug: String!
        fullName: String!
        bio: String
        photoAssetId: ID
        credentials: String
        expertiseAreas: [String!]
        displayOrder: Int
        isActive: Boolean
        isPublic: Boolean
    }

    input UpdateInstructorProfileInput {
        id: ID!
        customerId: ID
        slug: String
        fullName: String
        bio: String
        photoAssetId: ID
        credentials: String
        expertiseAreas: [String!]
        displayOrder: Int
        isActive: Boolean
        isPublic: Boolean
    }

    input CreateMediaResourceInput {
        ownerType: String!
        ownerId: String!
        type: String!
        url: String!
        title: String!
        thumbnailAssetId: ID
        displayOrder: Int
        isFeatured: Boolean
        isActive: Boolean
    }

    input UpdateMediaResourceInput {
        id: ID!
        ownerType: String
        ownerId: String
        type: String
        url: String
        title: String
        thumbnailAssetId: ID
        displayOrder: Int
        isFeatured: Boolean
        isActive: Boolean
    }

    extend type Query {
        tenantProfile(channelId: String): TenantProfile
        instructorProfiles(options: InstructorProfileListOptions): InstructorProfileList!
        instructorProfile(id: ID!): InstructorProfile
        mediaResources(options: MediaResourceListOptions): MediaResourceList!
        mediaResource(id: ID!): MediaResource
    }

    extend type Mutation {
        createTenantProfile(input: CreateTenantProfileInput!): TenantProfile!
        updateTenantProfile(input: UpdateTenantProfileInput!): TenantProfile!
        createInstructorProfile(input: CreateInstructorProfileInput!): InstructorProfile!
        updateInstructorProfile(input: UpdateInstructorProfileInput!): InstructorProfile!
        deleteInstructorProfile(id: ID!): Boolean!
        createMediaResource(input: CreateMediaResourceInput!): MediaResource!
        updateMediaResource(input: UpdateMediaResourceInput!): MediaResource!
        deleteMediaResource(id: ID!): Boolean!
    }
`;

export const shopApiExtensions = gql`
    ${sharedTypeExtensions}

    input RegisterTenantInput {
        businessName: String!
        firstName: String!
        lastName: String!
        emailAddress: String!
        password: String!
        contactEmail: String
        timezone: String
    }

    type RegisterTenantResult {
        channelId: ID!
        channelToken: String!
        administratorId: ID!
    }

    type VerifyTenantAdminResult {
        success: Boolean!
        message: String
        channelToken: String
    }

    extend type Query {
        instructorProfile(slug: String!): InstructorProfile
        instructorProfiles(options: InstructorProfileListOptions): InstructorProfileList!
        tenantProfile: TenantProfile
        mediaResources(ownerType: String!, ownerId: String!): [MediaResource!]!
    }

    extend type Mutation {
        registerNewTenant(input: RegisterTenantInput!): RegisterTenantResult!
        verifyTenantAdmin(token: String!): VerifyTenantAdminResult!
    }
`;
