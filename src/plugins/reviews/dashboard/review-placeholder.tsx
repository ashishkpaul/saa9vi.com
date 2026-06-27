import { Card, DashboardRouteDefinition } from '@vendure/dashboard';

function PlaceholderPage({ title, description }: { title: string; description: string }) {
    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">{title}</h1>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                    The backend entity exists, but this admin query has not been exposed yet. Add an admin GraphQL list query
                    for this resource to make this page fully interactive.
                </p>
            </Card>
        </div>
    );
}

export const reportList: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'reviews',
        id: 'review-reports',
        title: 'Reports',
        url: '/review-reports',
        requiresPermission: ['ReviewAdmin'],
    },
    path: '/review-reports',
    loader: () => ({ breadcrumb: 'Review reports' }),
    component: () => <PlaceholderPage title="Review reports" description="Moderation reports submitted by customers." />,
};

export const rewardList: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'reviews',
        id: 'review-rewards',
        title: 'Rewards',
        url: '/review-rewards',
        requiresPermission: ['ReviewAdmin'],
    },
    path: '/review-rewards',
    loader: () => ({ breadcrumb: 'Review rewards' }),
    component: () => <PlaceholderPage title="Review rewards" description="Incentives and reward issuance for reviews." />,
};

export const requestList: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'reviews',
        id: 'review-requests',
        title: 'Requests',
        url: '/review-requests',
        requiresPermission: ['ReviewAdmin'],
    },
    path: '/review-requests',
    loader: () => ({ breadcrumb: 'Review requests' }),
    component: () => <PlaceholderPage title="Review requests" description="Scheduled review request and reminder workflow." />,
};