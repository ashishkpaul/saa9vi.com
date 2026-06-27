import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    api,
    Badge,
    Button,
    Card,
    DashboardRouteDefinition,
    Input,
    Link,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    toast,
} from '@vendure/dashboard';
import { EyeIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ReviewStateBadge } from './components/review-state-badge';
import { StarRating } from './components/star-rating';

const GET_REVIEWS = `
  query GetProductReviews($options: ProductReviewListOptions) {
    productReviews(options: $options) {
      items {
        id
        createdAt
        summary
        rating
        authorName
        state
        verifiedPurchase
        product { id name slug }
      }
      totalItems
    }
  }
`;

const MODERATION_MUTATIONS: Record<string, string> = {
    approve: `mutation ApproveProductReview($id: ID!) { approveProductReview(id: $id) { id state } }`,
    reject: `mutation RejectProductReview($id: ID!) { rejectProductReview(id: $id) { id state } }`,
    hide: `mutation HideProductReview($id: ID!) { hideProductReview(id: $id) { id state } }`,
};

interface ReviewListItem {
    id: string;
    createdAt: string;
    summary: string;
    rating: number;
    authorName: string;
    state: string;
    verifiedPurchase: boolean;
    product?: { id: string; name: string; slug: string } | null;
}

export const reviewList: DashboardRouteDefinition = {
    path: '/reviews',
    loader: () => ({ breadcrumb: 'Reviews' }),
    component: () => <ReviewListPage />,
    navMenuItem: {
        sectionId: 'reviews',
        id: 'review-list',
        title: 'Reviews',
        url: '/reviews',
        requiresPermission: ['ReviewAdmin'],
    },
};

function ReviewListPage() {
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const pageSize = 25;

    const { data, isLoading } = useQuery<{ productReviews: { items: ReviewListItem[]; totalItems: number } }>({
        queryKey: ['productReviews', page],
        queryFn: () => api.query(GET_REVIEWS, { options: { skip: (page - 1) * pageSize, take: pageSize } }),
        placeholderData: previous => previous,
    });

    const moderationMutation = useMutation({
        mutationFn: ({ action, id }: { action: keyof typeof MODERATION_MUTATIONS; id: string }) =>
            api.mutate(MODERATION_MUTATIONS[action], { id }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['productReviews'] });
            toast.success('Review updated');
        },
        onError: (error: Error) => toast.error('Failed to update review', { description: error.message }),
    });

    const items = data?.productReviews.items ?? [];
    const totalItems = data?.productReviews.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const visibleItems = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return items;
        return items.filter(review =>
            review.summary.toLowerCase().includes(q) ||
            review.authorName.toLowerCase().includes(q) ||
            review.product?.name?.toLowerCase().includes(q),
        );
    }, [items, search]);

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Reviews</h1>
                <p className="text-sm text-muted-foreground">Moderate product reviews and inspect customer feedback.</p>
            </div>
            <Card className="p-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <Input placeholder="Search reviews" value={search} onChange={event => setSearch(event.target.value)} />
                    <Badge variant="outline">{totalItems} total</Badge>
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Review</TableHead>
                            <TableHead>Rating</TableHead>
                            <TableHead>Product</TableHead>
                            <TableHead>Author</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={7}>Loading reviews…</TableCell></TableRow>
                        ) : visibleItems.length === 0 ? (
                            <TableRow><TableCell colSpan={7}>No reviews found.</TableCell></TableRow>
                        ) : visibleItems.map(review => (
                            <TableRow key={review.id}>
                                <TableCell className="font-medium">{review.summary}</TableCell>
                                <TableCell><StarRating rating={review.rating} /></TableCell>
                                <TableCell>{review.product?.name ?? '—'}</TableCell>
                                <TableCell>
                                    <div>{review.authorName}</div>
                                    {review.verifiedPurchase && <Badge variant="outline">Verified</Badge>}
                                </TableCell>
                                <TableCell><ReviewStateBadge state={review.state} /></TableCell>
                                <TableCell>{new Date(review.createdAt).toLocaleDateString()}</TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-2 flex-wrap">
                                        <Button size="sm" variant="outline" render={<Link to={`/reviews/${review.id}`} />}>
                                            <EyeIcon className="h-4 w-4" />
                                        </Button>
                                        <Button size="sm" onClick={() => moderationMutation.mutate({ action: 'approve', id: review.id })}>Approve</Button>
                                        <Button size="sm" variant="secondary" onClick={() => moderationMutation.mutate({ action: 'hide', id: review.id })}>Hide</Button>
                                        <Button size="sm" variant="destructive" onClick={() => moderationMutation.mutate({ action: 'reject', id: review.id })}>Reject</Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                    <div className="flex gap-2">
                        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                        <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
                    </div>
                </div>
            </Card>
        </div>
    );
}