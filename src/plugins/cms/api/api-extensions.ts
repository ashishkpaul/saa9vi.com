import gql from 'graphql-tag';

/**
 * Types shared between Admin and Shop schemas.
 *
 * WHY THIS EXISTS:
 * Vendure builds two independent GraphQL schemas — admin and shop — so any
 * type referenced in shopApiExtensions MUST be defined in the shop schema
 * too; you cannot borrow from adminApiExtensions. We solve this by collecting
 * all shared entity types here and spreading them into both schemas.
 *
 * WHY THE EMPTY `input XxxListOptions` STUBS:
 * Vendure auto-generates the filter/sort/pagination fields for a list options
 * input at startup, BUT only when it finds the stub `input XxxListOptions`
 * already declared in the schema alongside the matching `XxxList implements
 * PaginatedList` type. Without the stub, the Dashboard's Vite/gql-tada build
 * throws "Unknown type XxxListOptions" and aborts.
 *
 * WHY CmsPage NOT Page:
 * `Page` collides with an existing type in the Vendure admin schema (or an
 * installed plugin). Namespacing it as `CmsPage` is idiomatic for plugin
 * authors — it avoids the collision and makes it clear where the type lives.
 * The underlying TypeScript/TypeORM class remains `Page` (no rename needed
 * there — entity table name is unaffected).
 */
const sharedTypeExtensions = gql`
    type Article implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        slug: String!
        title: String!
        excerpt: String
        body: String!
        isPublished: Boolean!
        publishedAt: DateTime
        featuredAsset: Asset
        tags: [String!]
        channels: [Channel!]!
    }

    type ArticleList implements PaginatedList {
        items: [Article!]!
        totalItems: Int!
    }

    input ArticleListOptions {
        skip: Int
        take: Int
    }

    enum BannerPlacement {
        HOMEPAGE_HERO
        HOMEPAGE_STRIP
        CATEGORY_TOP
        SIDEBAR
        CHECKOUT_PROMO
    }

    enum BannerScope {
        tenant
        marketplace
    }

    type Banner implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        title: String!
        image: Asset!
        linkUrl: String
        placement: BannerPlacement!
        priority: Int!
        isActive: Boolean!
        startsAt: DateTime
        endsAt: DateTime
        scope: BannerScope!
        targetSubject: String
        targetCity: String
        campaignId: ID
        channels: [Channel!]!
    }

    type BannerList implements PaginatedList {
        items: [Banner!]!
        totalItems: Int!
    }

    input BannerListOptions {
        skip: Int
        take: Int
    }

    """
    Sections are stored as a JSON column (discriminated-union of hero, richText,
    productGrid, articleGrid, bannerSlot blocks). See types.ts for the TS union.
    Exposed as JSON so new section types don't require a schema migration.
    """
    type CmsPage implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        slug: String!
        title: String!
        metaDescription: String
        isPublished: Boolean!
        sections: JSON!
        channels: [Channel!]!
    }

    type CmsPageList implements PaginatedList {
        items: [CmsPage!]!
        totalItems: Int!
    }

    input CmsPageListOptions {
        skip: Int
        take: Int
    }
`;

export const adminApiExtensions = gql`
    ${sharedTypeExtensions}

    # CmsDeletionResponse uses DeletionResult which is an admin-only enum,
    # so it must NOT be in sharedTypeExtensions (shop schema doesn't have it).
    type CmsDeletionResponse {
        result: DeletionResult!
    }

    input CreateArticleInput {
        slug: String!
        title: String!
        excerpt: String
        body: String!
        isPublished: Boolean
        featuredAssetId: ID
        tags: [String!]
        channelIds: [ID!]
    }

    input UpdateArticleInput {
        id: ID!
        slug: String
        title: String
        excerpt: String
        body: String
        isPublished: Boolean
        featuredAssetId: ID
        tags: [String!]
        channelIds: [ID!]
    }

    input CreateBannerInput {
        title: String!
        imageId: ID!
        linkUrl: String
        placement: BannerPlacement!
        priority: Int
        isActive: Boolean
        startsAt: DateTime
        endsAt: DateTime
        channelIds: [ID!]
        \"\"\"FEAT-004: 'marketplace' requires SuperAdmin; tenants always get 'tenant'.\"\"\"
        scope: BannerScope
        targetSubject: String
        targetCity: String
        campaignId: ID
    }

    input UpdateBannerInput {
        id: ID!
        title: String
        imageId: ID
        linkUrl: String
        placement: BannerPlacement
        priority: Int
        isActive: Boolean
        startsAt: DateTime
        endsAt: DateTime
        channelIds: [ID!]
        \"\"\"FEAT-004: 'marketplace' requires SuperAdmin; scope flip by a tenant admin is forced to 'tenant'.\"\"\"
        scope: BannerScope
        targetSubject: String
        targetCity: String
        campaignId: ID
    }

    input CreatePageInput {
        slug: String!
        title: String!
        metaDescription: String
        isPublished: Boolean
        sections: JSON
        channelIds: [ID!]
    }

    input UpdatePageInput {
        id: ID!
        slug: String
        title: String
        metaDescription: String
        isPublished: Boolean
        sections: JSON
        channelIds: [ID!]
    }

    extend type Query {
        articles(options: ArticleListOptions): ArticleList!
        article(id: ID!): Article
        banners(options: BannerListOptions): BannerList!
        banner(id: ID!): Banner
        # Prefixed to match entity rename (CmsPage) and avoid potential query-name collision
        cmsPages(options: CmsPageListOptions): CmsPageList!
        cmsPage(id: ID!): CmsPage
    }

    extend type Mutation {
        createArticle(input: CreateArticleInput!): Article!
        updateArticle(input: UpdateArticleInput!): Article!
        deleteArticle(id: ID!): CmsDeletionResponse!

        createBanner(input: CreateBannerInput!): Banner!
        updateBanner(input: UpdateBannerInput!): Banner!
        deleteBanner(id: ID!): CmsDeletionResponse!

        createPage(input: CreatePageInput!): CmsPage!
        updatePage(input: UpdatePageInput!): CmsPage!
        deletePage(id: ID!): CmsDeletionResponse!
    }
`;

/**
 * Shop API: read-only, published content only, no mutations.
 *
 * Includes sharedTypeExtensions so the shop schema has its own copies of
 * Article, Banner, CmsPage, BannerPlacement and their ListOptions stubs —
 * required because admin and shop are separate schemas in Vendure.
 */
export const shopApiExtensions = gql`
    ${sharedTypeExtensions}

    extend type Query {
        cmsArticle(slug: String!): Article
        cmsArticles(options: ArticleListOptions): ArticleList!
        cmsPage(slug: String!): CmsPage
        cmsBanners(placement: BannerPlacement!): [Banner!]!
    }
`;
