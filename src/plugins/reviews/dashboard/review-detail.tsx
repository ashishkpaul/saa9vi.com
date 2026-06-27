import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    api,
    Button,
    Card,
    DashboardRouteDefinition,
    Label,
    Textarea,
    toast,
    useNavigate,
} from '@vendure/dashboard';
import type { AnyRoute } from '@vendure/dashboard';
import { useEffect, useState } from 'react';
import { ReviewStateBadge } from './components/review-state-badge';
import { StarRating } from './components/star-rating';

const GET_REVIEW = `
  query GetProductReview($id: ID!) {
    productReview(id: $id) {
      id
      createdAt
      updatedAt
      summary
      body
      rating
      authorName
      authorLocation
      state
      verifiedPurchase
      response
      responseCreatedAt
      product { id name slug }
      productVariant { id name sku }
      author { id firstName lastName emailAddress }
      assets { id preview source }
    }
  }
`;

const RESPOND_TO_REVIEW = `
  mutation RespondToReview($id: ID!, $response: String!) {
    respondToReview(id: $id, response: $response) { id response responseCreatedAt }
  }
`;

const MODERATION_MUTATIONS: Record<string, string> = {
    approve: `mutation ApproveProductReview($id: ID!) { approveProductReview(id: $id) { id state } }`,
    reject: `mutation RejectProductReview($id: ID!) { rejectProductReview(id: $id) { id state } }`,
    hide: `mutation HideProductReview($id: ID!) { hideProductReview(id: $id) { id state } }`,
};

interface ProductReviewDetail {
    id: string;
    createdAt: string;
    updatedAt: string;
    summary: string;
    body?: string | null;
    rating: number;
    authorName: string;
    authorLocation?: string | null;
    state: string;
    verifiedPurchase: boolean;
    response?: string | null;
    responseCreatedAt?: string | null;
    product?: { id: string; name: string; slug: string } | null;
    productVariant?: { id: string; name: string; sku: string } | null;
    author?: { id: string; firstName: string; lastName: string; emailAddress: string } | null;
    assets?: Array<{ id: string; preview: string; source: string }> | null;
}

export const reviewDetail: DashboardRouteDefinition = {
    path: '/reviews/$id',
    loader: () => ({ breadcrumb: 'Review detail' }),
    component: route => <ReviewDetailPage route={route} />,
};

function ReviewDetailPage({ route }: { route: AnyRoute }) {
    const params = route.useParams();
    const id = params.id;
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery<{ productReview: ProductReviewDetail | null }>({
        queryKey: ['productReview', id],
        queryFn: () => api.query(GET_REVIEW, { id }),
    });
    const review = data?.productReview;
    const [response, setResponse] = useState('');

    useEffect(() => {
        setResponse(review?.response ?? '');
    }, [review?.id, review?.response]);

    const saveResponseMutation = useMutation({
        mutationFn: () => api.mutate(RESPOND_TO_REVIEW, { id, response }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['productReview', id] });
            toast.success('Response saved');
        },
        onError: (error: Error) => toast.error('Failed to save response', { description: error.message }),
    });

    const moderationMutation = useMutation({
        mutationFn: (action: keyof typeof MODERATION_MUTATIONS) => api.mutate(MODERATION_MUTATIONS[action], { id }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['productReview', id] });
            toast.success('Review updated');
        },
        onError: (error: Error) => toast.error('Failed to update review', { description: error.message }),
    });

    if (isLoading) {
        return <div className="p-6">Loading review…</div>;
    }
    if (!review) {
        return <div className="p-6">Review not found.</div>;
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <Button variant="ghost" onClick={() => navigate({ to: '/reviews' })}>← Back to reviews</Button>
                    <h1 className="mt-2 text-2xl font-semibold">{review.summary}</h1>
                    <div className="mt-2 flex items-center gap-3">
                        <StarRating rating={review.rating} />
                        <ReviewStateBadge state={review.state} />
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button onClick={() => moderationMutation.mutate('approve')}>Approve</Button>
                    <Button variant="secondary" onClick={() => moderationMutation.mutate('hide')}>Hide</Button>
                    <Button variant="destructive" onClick={() => moderationMutation.mutate('reject')}>Reject</Button>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                <Card className="p-4 space-y-4">
                    <div>
                        <h2 className="font-semibold">Review body</h2>
                        <p className="mt-2 whitespace-pre-wrap text-sm">{review.body || 'No body provided.'}</p>
                    </div>
                    {review.assets?.length ? (
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            {review.assets.map(asset => (
                                <img key={asset.id} src={asset.preview} alt="Review asset" className="rounded border object-cover" />
                            ))}
                        </div>
                    ) : null}
                    <div className="space-y-2">
                        <Label>Merchant response</Label>
                        <Textarea value={response} onChange={event => setResponse(event.target.value)} rows={5} />
                        <Button onClick={() => saveResponseMutation.mutate()}>Save response</Button>
                    </div>
                </Card>

                <Card className="p-4 space-y-3 text-sm">
                    <h2 className="font-semibold">Details</h2>
                    <div><strong>Author:</strong> {review.authorName}</div>
                    <div><strong>Location:</strong> {review.authorLocation || '—'}</div>
                    <div><strong>Customer:</strong> {review.author?.emailAddress || '—'}</div>
                    <div><strong>Product:</strong> {review.product?.name || '—'}</div>
                    <div><strong>Variant:</strong> {review.productVariant?.name || '—'}</div>
                    <div><strong>Verified purchase:</strong> {review.verifiedPurchase ? 'Yes' : 'No'}</div>
                    <div><strong>Created:</strong> {new Date(review.createdAt).toLocaleString()}</div>
                    <div><strong>Updated:</strong> {new Date(review.updatedAt).toLocaleString()}</div>
                </Card>
            </div>
        </div>
    );
}