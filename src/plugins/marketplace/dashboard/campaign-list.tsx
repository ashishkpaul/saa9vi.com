import { ActionBarItem, Badge, Button, DashboardRouteDefinition, DetailPageButton, Link, ListPage } from '@vendure/dashboard';
import { PlusIcon } from 'lucide-react';
import { graphql } from '@/gql';

const getCampaignList = graphql(`
    query GetCampaigns {
        campaigns {
            id
            type
            status
            budgetInPaise
            spentInPaise
            targetSubject
            targetCity
            startsAt
            endsAt
            boostWeight
            createdAt
        }
    }
`);

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    active: 'default',
    paused: 'secondary',
    draft: 'outline',
    exhausted: 'destructive',
};

function formatPaise(paise: number): string {
    return `₹${(paise / 100).toFixed(2)}`;
}

function formatDate(date: string): string {
    return new Date(date).toLocaleDateString();
}

export const campaignList: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketplace',
        id: 'ad-campaigns',
        url: '/ad-campaigns',
        title: 'Campaigns',
        requiresPermission: ['MarketplaceAdvertising_Read'],
    },
    path: '/ad-campaigns',
    loader: () => ({ breadcrumb: 'Ad Campaigns' }),
    component: route => (
        <ListPage
            pageId="campaign-list"
            title="Ad Campaigns"
            listQuery={getCampaignList}
            route={route}
            customizeColumns={{
                type: {
                    header: 'Type',
                    cell: ({ row }) => (
                        <Badge variant="outline">{row.original.type}</Badge>
                    ),
                },
                status: {
                    header: 'Status',
                    cell: ({ row }) => (
                        <Badge variant={STATUS_VARIANT[row.original.status] ?? 'outline'}>
                            {row.original.status}
                        </Badge>
                    ),
                },
                budgetInPaise: {
                    header: 'Budget',
                    cell: ({ row }) => formatPaise(row.original.budgetInPaise),
                },
                spentInPaise: {
                    header: 'Spent',
                    cell: ({ row }) => formatPaise(row.original.spentInPaise),
                },
                targetSubject: {
                    header: 'Target',
                    cell: ({ row }) => row.original.targetSubject ?? '—',
                },
                startsAt: {
                    header: 'Starts',
                    cell: ({ row }) => formatDate(row.original.startsAt),
                },
                endsAt: {
                    header: 'Ends',
                    cell: ({ row }) => formatDate(row.original.endsAt),
                },
            }}
        >
            <ActionBarItem itemId="new-campaign">
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    New campaign
                </Button>
            </ActionBarItem>
        </ListPage>
    ),
};
