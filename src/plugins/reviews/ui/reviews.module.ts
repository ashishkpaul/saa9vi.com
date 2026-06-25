import { NgModule } from "@angular/core";
import { SharedModule } from "@vendure/admin-ui/core";

// Components
import { AllProductReviewsListComponent } from "./components/all-product-reviews-list/all-product-reviews-list.component";
import { RelationReviewInputComponent } from "./components/featured-review-selector/featured-review-selector.component";
import { ProductReviewDetailComponent } from "./components/product-review-detail/product-review-detail.component";
import { ProductReviewsListComponent } from "./components/product-reviews-list/product-reviews-list.component";
import { ReviewCountLinkComponent } from "./components/review-count-link/review-count-link.component";
import { ReviewHistogramComponent } from "./components/review-histogram/review-histogram.component";
import { ReviewStateLabelComponent } from "./components/review-state-label/review-state-label.component";
import { StarRatingComponent } from "./components/star-rating/star-rating.component";
import { ReviewsWidgetComponent } from "./widgets/reviews-widget/reviews-widget.component";

@NgModule({
  imports: [
    SharedModule,
    // Standalone components
    AllProductReviewsListComponent,
    RelationReviewInputComponent,
    ProductReviewDetailComponent,
    ProductReviewsListComponent,
    ReviewCountLinkComponent,
    ReviewHistogramComponent,
    ReviewStateLabelComponent,
    StarRatingComponent,
    ReviewsWidgetComponent,
  ],
  declarations: [],
  exports: [],
})
export class ReviewsUiModule {}
