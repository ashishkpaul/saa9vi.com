import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { DataService, ItemOf, SharedModule, PermissionsService } from '@vendure/admin-ui/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import gql from 'graphql-tag';
import { GetReviewsForWidgetDocument, GetReviewsForWidgetQuery } from '../../generated-types';
import { StarRatingComponent } from '../../components/star-rating/star-rating.component';
import { ReviewStateLabelComponent } from '../../components/review-state-label/review-state-label.component';
import { REVIEW_ADMIN_PERMISSION_VALUE } from '../../constants';

const GET_REVIEWS_FOR_WIDGET = gql`
    query GetReviewsForWidget($options: ProductReviewListOptions) {
        productReviews(options: $options) {
            items {
                id
                authorName
                summary
                rating
                state
                createdAt
                product {
                    id
                    name
                }
            }
            totalItems
        }
    }
`;

@Component({
    selector: 'vdr-reviews-widget',
    templateUrl: './reviews-widget.component.html',
    styleUrls: ['./reviews-widget.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [SharedModule, StarRatingComponent, ReviewStateLabelComponent],
})
export class ReviewsWidgetComponent implements OnInit {
    pendingReviews$: Observable<ItemOf<GetReviewsForWidgetQuery, 'productReviews'>[]>;
    hasPermission$: Observable<boolean>;
    constructor(private dataService: DataService, private permissionsService: PermissionsService) {}

    ngOnInit() {
        this.hasPermission$ = this.permissionsService.currentUserPermissions$.pipe(
            map(() => this.permissionsService.userHasPermissions([REVIEW_ADMIN_PERMISSION_VALUE]))
        );
        this.pendingReviews$ = this.dataService
            .query(GetReviewsForWidgetDocument, {
                options: {
                    filter: {
                        state: {
                            eq: 'new',
                        },
                    },
                    take: 10,
                },
            })
            .mapStream(data => data.productReviews.items);
    }
}
