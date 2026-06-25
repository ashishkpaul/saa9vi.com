import {
  addNavMenuItem,
  registerDashboardWidget,
  registerFormInputComponent,
  registerPageTab,
  setDashboardWidgetLayout,
} from "@vendure/admin-ui/core";

import { REVIEW_ADMIN_PERMISSION_VALUE } from "./constants";
import { ReviewCountLinkComponent } from "./components/review-count-link/review-count-link.component";
import { StarRatingComponent } from "./components/star-rating/star-rating.component";
import { RelationReviewInputComponent } from "./components/featured-review-selector/featured-review-selector.component";
import { ProductReviewsListComponent } from "./components/product-reviews-list/product-reviews-list.component";
export default [
  registerFormInputComponent("review-count-link", ReviewCountLinkComponent),
  registerFormInputComponent("star-rating-form-input", StarRatingComponent),
  registerFormInputComponent(
    "review-selector-form-input",
    RelationReviewInputComponent,
  ),
  addNavMenuItem(
    {
      id: "reviews",
      label: "Product reviews",
      routerLink: ["/extensions/product-reviews"],
      icon: "star",
      requiresPermission: "UpdateProduct", // Only show if user has this permission
    },
    "marketing",
  ),
  // Widget registration disabled for now to avoid NodeJS compilation issues
  // in the server build. The widget code is available at:
  // ./widgets/reviews-widget/
  // TODO: Fix dynamic import for webpack admin-ui build
  // registerDashboardWidget("reviews", {
  //   title: "Latest reviews",
  //   supportedWidths: [4, 6, 8, 12],
  //   loadComponent: () =>
  //     import("./widgets/reviews-widget/reviews-widget.component").then(
  //       (m) => m.ReviewsWidgetComponent,
  //     ),
  //   requiresPermissions: [REVIEW_ADMIN_PERMISSION_VALUE],
  // }),
  setDashboardWidgetLayout([
    { id: "metrics", width: 12 },
    { id: "orderSummary", width: 6 },
    { id: "reviews", width: 6 },
    { id: "latestOrders", width: 12 },
  ]),
  registerPageTab({
    location: "product-detail",
    route: "reviews",
    tab: "Reviews",
    tabIcon: "star",
    component: ProductReviewsListComponent,
  }),
];
