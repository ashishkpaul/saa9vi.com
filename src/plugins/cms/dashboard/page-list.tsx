import { ActionBarItem, Badge, Button, DashboardRouteDefinition, DetailPageButton, Link, ListPage } from '@vendure/dashboard';
import { PlusIcon } from 'lucide-react';
import { graphql } from '@/gql';

const getCmsPageList = graphql(`
    query GetCmsPages($options: CmsPageListOptions) {
        cmsPages(options: $options) {
            items {
                id
                createdAt
                updatedAt
                title
                slug
                isPublished
                channels {
                    id
                    code
                }
            }
            totalItems
        }
    }
`);

const deletePageDocument = graphql(`
    mutation DeletePage($id: ID!) {
        deletePage(id: $id) {
            result
        }
    }
`);

export const pageList: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'cms',
        id: 'pages',
        url: '/pages',
        title: 'Pages',
        requiresPermission: ['ReadCmsPage'],
    },
    path: '/pages',
    loader: () => ({ breadcrumb: 'Pages' }),
    component: route => (
        <ListPage
            pageId="page-list"
            title="Pages"
            listQuery={getCmsPageList}
            deleteMutation={deletePageDocument}
            route={route}
            customizeColumns={{
                title: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.title} />,
                },
                isPublished: {
                    header: 'Status',
                    cell: ({ row }) => (
                        <Badge variant={row.original.isPublished ? 'default' : 'secondary'}>
                            {row.original.isPublished ? 'Published' : 'Draft'}
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
            <ActionBarItem itemId="new-page">
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    New page
                </Button>
            </ActionBarItem>
        </ListPage>
    ),
};
