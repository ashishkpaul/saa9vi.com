import { ActionBarItem, Badge, Button, DashboardRouteDefinition, DetailPageButton, Link, ListPage } from '@vendure/dashboard';
import { PlusIcon } from 'lucide-react';
import { graphql } from '@/gql';

const getBannerList = graphql(`
    query GetBanners($options: BannerListOptions) {
        banners(options: $options) {
            items {
                id
                createdAt
                updatedAt
                title
                placement
                priority
                isActive
                startsAt
                endsAt
                channels {
                    id
                    code
                }
            }
            totalItems
        }
    }
`);

const deleteBannerDocument = graphql(`
    mutation DeleteBanner($id: ID!) {
        deleteBanner(id: $id) {
            result
        }
    }
`);

export const bannerList: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'cms',
        id: 'banners',
        url: '/banners',
        title: 'Banners',
        requiresPermission: ['ReadCmsBanner'],
    },
    path: '/banners',
    loader: () => ({ breadcrumb: 'Banners' }),
    component: route => (
        <ListPage
            pageId="banner-list"
            title="Banners"
            listQuery={getBannerList}
            deleteMutation={deleteBannerDocument}
            route={route}
            customizeColumns={{
                title: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.title} />,
                },
                isActive: {
                    header: 'Status',
                    cell: ({ row }) => (
                        <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
                            {row.original.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                    ),
                },
                channels: {
                    header: 'Channels',
                    cell: ({ row }) => (
                        <div className="flex flex-wrap gap-1">
                            {row.original.channels.map(c => (
                                <Badge key={c.id} variant="outline">
                                    {c.code}
                                </Badge>
                            ))}
                        </div>
                    ),
                },
            }}
        >
            <ActionBarItem itemId="new-banner">
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    New banner
                </Button>
            </ActionBarItem>
        </ListPage>
    ),
};
