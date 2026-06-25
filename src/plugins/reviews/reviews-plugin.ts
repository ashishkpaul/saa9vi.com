import { LanguageCode, PluginCommonModule, VendurePlugin } from "@vendure/core";

import { ProductReview } from "./entities/product-review.entity";
import { ReviewRequest } from "./entities/review-request.entity";
import { ReviewReport } from "./entities/review-report.entity";
import { ReviewReward } from "./entities/review-reward.entity";
import { ReviewVote } from "./entities/review-vote.entity";
import { adminApiExtensions, shopApiExtensions } from "./api/api-extensions";
import { ProductEntityResolver } from "./api/product-entity.resolver";
import { ProductReviewAdminResolver } from "./api/product-review-admin.resolver";
import { ProductReviewEntityResolver } from "./api/product-review-entity.resolver";
import { ProductReviewShopResolver } from "./api/product-review-shop.resolver";
import { ReviewUploadController } from "./api/review-upload.controller";
import { ProductReviewService } from "./services/product-review.service";
import { ReviewRequestService } from "./services/review-request.service";
import { ReviewAggregationService } from "./services/review-aggregation.service";
import { ReviewCacheService } from "./services/review-cache.service";
import { ReviewEmailService } from "./services/review-email.service";
import { ReviewRewardService } from "./services/review-reward.service";
import { ReviewReportService } from "./services/review-report.service";
import { ReviewAntiFraudService } from "./services/review-antifraud.service";
import { ReviewEventListener } from "./events/review-event.listener";
import { ReviewRequestListener } from "./events/review-request.listener";
import { ReviewService } from "./services/review.service";
import { ReviewAbstractionBootstrap } from "./infrastructure/review-abstraction.bootstrap";
import { ReviewAggregationStrategyRegistry } from "./infrastructure/review-aggregation-strategy.registry";
import { ReviewEligibilityStrategyRegistry } from "./infrastructure/review-eligibility-strategy.registry";
import { ReviewTargetRegistry } from "./infrastructure/review-target.registry";
import { ProductReviewTargetProvider } from "./providers/product-review-target.provider";
import { ProductReviewAggregationStrategy } from "./strategies/product-aggregation.strategy";
import { ProductReviewEligibilityStrategy } from "./strategies/product-eligibility.strategy";
import { REVIEW_ADMIN_PERMISSION } from "./constants";

/**
 * ReviewsPlugin
 *
 * Provides product review functionality including:
 * - Review submission and moderation workflow
 * - Rating aggregation on products
 * - Admin UI for review management
 * - Review voting and featured review selection
 *
 * Usage:
 * 1. Import ReviewsPlugin in vendure-config.ts plugins array
 * 2. Run migrations to create the product_review table
 * 3. Access Admin UI at /admin under the "product-reviews" route
 */
@VendurePlugin({
  imports: [PluginCommonModule],
  controllers: [ReviewUploadController],
  entities: [
    ProductReview,
    ReviewRequest,
    ReviewReport,
    ReviewReward,
    ReviewVote,
  ],
  providers: [
    ProductReviewService,
    ReviewRequestService,
    ReviewAggregationService,
    ReviewCacheService,
    ReviewEmailService,
    ReviewRewardService,
    ReviewReportService,
    ReviewAntiFraudService,
    ReviewEventListener,
    ReviewRequestListener,
    // Phase 1A: Reputation abstraction layer
    ReviewService,
    ReviewAbstractionBootstrap,
    ReviewTargetRegistry,
    ReviewEligibilityStrategyRegistry,
    ReviewAggregationStrategyRegistry,
    ProductReviewTargetProvider,
    ProductReviewAggregationStrategy,
    ProductReviewEligibilityStrategy,
  ],
  adminApiExtensions: {
    schema: adminApiExtensions,
    resolvers: [
      ProductEntityResolver,
      ProductReviewAdminResolver,
      ProductReviewEntityResolver,
    ],
  },
  shopApiExtensions: {
    schema: shopApiExtensions,
    resolvers: [
      ProductEntityResolver,
      ProductReviewShopResolver,
      ProductReviewEntityResolver,
    ],
  },
  configuration: (config) => {
    config.authOptions.customPermissions ??= [];
    if (!config.authOptions.customPermissions.some((p: any) => p?.name === (REVIEW_ADMIN_PERMISSION as any).name)) {
      config.authOptions.customPermissions.push(REVIEW_ADMIN_PERMISSION);
    }

    config.customFields.Product ??= [];
    const existingFields = new Set(config.customFields.Product.map((f: any) => f.name));

    if (!existingFields.has('reviewRating')) {
      config.customFields.Product.push({
        name: 'reviewRating',
        label: [{ languageCode: LanguageCode.en, value: 'Review rating' }],
        public: true,
        nullable: true,
        type: 'float',
        ui: { tab: 'Reviews', component: 'star-rating-form-input' },
      });
    }
    if (!existingFields.has('reviewCount')) {
      config.customFields.Product.push({
        name: 'reviewCount',
        label: [{ languageCode: LanguageCode.en, value: 'Review count' }],
        public: true,
        defaultValue: 0,
        type: 'float',
        ui: { tab: 'Reviews', component: 'review-count-link' },
      });
    }
    if (!existingFields.has('featuredReview')) {
      config.customFields.Product.push({
        name: 'featuredReview',
        label: [{ languageCode: LanguageCode.en, value: 'Featured review' }],
        public: true,
        type: 'relation',
        entity: ProductReview,
        ui: { tab: 'Reviews', component: 'review-selector-form-input' },
      });
    }
    return config;
  },
})
export class ReviewsPlugin {}
