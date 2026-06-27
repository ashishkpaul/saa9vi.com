import { defineDashboardExtension } from '@vendure/dashboard';
import { MessageSquareTextIcon } from 'lucide-react';
import { reviewDetail } from './review-detail';
import { reviewList } from './review-list';
import { reportList, requestList, rewardList } from './review-placeholder';

export default defineDashboardExtension({
    routes: [reviewList, reviewDetail, reportList, rewardList, requestList],
    navSections: [
        {
            id: 'reviews',
            title: 'Reviews',
            icon: MessageSquareTextIcon,
            placement: 'top',
            order: 120,
        },
    ],
});
