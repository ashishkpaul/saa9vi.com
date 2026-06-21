import gql from 'graphql-tag';

export const adminApiExtensions = gql`
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
        customFields: JSON
    }

    type ArticleList implements PaginatedList {
        items: [Article!]!
        totalItems: Int!
    }

    input ArticleListOptions {
        skip: Int
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

    enum BannerPlacement {
        HOMEPAGE_HERO
        HOMEPAGE_STRIP
        CATEGORY_TOP
        SIDEBAR
        CHECKOUT_PROMO
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
        channels: [Channel!]!
        customFields: JSON
    }

    type BannerList implements PaginatedList {
        items: [Banner!]!
        totalItems: Int!
    }

    input BannerListOptions {
        skip: Int
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
    }

    """
    Sections are stored as JSON. Shape is validated server-side against the
    PageSection union defined in the plugin's types.ts but exposed here as
    JSON for flexibility as new section types are added.
    """
    type Page implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        slug: String!
        title: String!
        metaDescription: String
        isPublished: Boolean!
        sections: JSON!
        channels: [Channel!]!
        customFields: JSON
    }

    type PageList implements PaginatedList {
        items: [Page!]!
        totalItems: Int!
    }

    input PageListOptions {
        skip: Int
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

    type CmsDeletionResponse {
        result: DeletionResult!
    }

    extend type Query {
        articles(options: ArticleListOptions): ArticleList!
        article(id: ID!): Article
        banners(options: BannerListOptions): BannerList!
        banner(id: ID!): Banner
        pages(options: PageListOptions): PageList!
        page(id: ID!): Page
    }

    extend type Mutation {
        createArticle(input: CreateArticleInput!): Article!
        updateArticle(input: UpdateArticleInput!): Article!
        deleteArticle(id: ID!): CmsDeletionResponse!

        createBanner(input: CreateBannerInput!): Banner!
        updateBanner(input: UpdateBannerInput!): Banner!
        deleteBanner(id: ID!): CmsDeletionResponse!

        createPage(input: CreatePageInput!): Page!
        updatePage(input: UpdatePageInput!): Page!
        deletePage(id: ID!): CmsDeletionResponse!
    }
`;

/**
 * Shop API only ever needs to *read* published content scoped to the active
 * channel — no mutations, no draft/unpublished visibility.
 *
 * We define separate types here rather than reusing admin types because the
 * Shop API schema is built independently; admin-only fields (customFields,
 * etc.) are stripped.
 */
export const shopApiExtensions = gql`
    enum BannerPlacement {
        HOMEPAGE_HERO
        HOMEPAGE_STRIP
        CATEGORY_TOP
        SIDEBAR
        CHECKOUT_PROMO
    }

    input ArticleListOptions {
        skip: Int
    }

    type ShopCmsArticle implements Node {
        id: ID!
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

    type ShopCmsArticleList implements PaginatedList {
        items: [ShopCmsArticle!]!
        totalItems: Int!
    }

    type ShopCmsPage implements Node {
        id: ID!
        slug: String!
        title: String!
        metaDescription: String
        isPublished: Boolean!
        sections: JSON!
        channels: [Channel!]!
    }

    type ShopCmsPageList implements PaginatedList {
        items: [ShopCmsPage!]!
        totalItems: Int!
    }

    type ShopCmsBanner implements Node {
        id: ID!
        title: String!
        image: Asset!
        linkUrl: String
        placement: BannerPlacement!
        priority: Int!
        isActive: Boolean!
        channels: [Channel!]!
    }

    extend type Query {
        cmsArticle(slug: String!): ShopCmsArticle
        cmsArticles(options: ArticleListOptions): ShopCmsArticleList!
        cmsPage(slug: String!): ShopCmsPage
        cmsBanners(placement: BannerPlacement!): [ShopCmsBanner!]!
    }
`;