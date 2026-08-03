import { ActionBarItem, Badge, Button, DashboardRouteDefinition, DetailPageButton, Link, ListPage } from '@vendure/dashboard';
import { PlusIcon } from 'lucide-react';
import { graphql } from '@/gql';

const getArticleList = graphql(`
    query GetArticles($options: ArticleListOptions) {
        articles(options: $options) {
            items {
                id
                createdAt
                updatedAt
                title
                slug
                isPublished
                publishedAt
                channels {
                    id
                    code
                }
            }
            totalItems
        }
    }
`);

const deleteArticleDocument = graphql(`
    mutation DeleteArticle($id: ID!) {
        deleteArticle(id: $id) {
            result
        }
    }
`);

export const articleList: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'cms',
        id: 'articles',
        url: '/articles',
        title: 'Articles',
        requiresPermission: ['ReadCmsArticle'],
    },
    path: '/articles',
    loader: () => ({ breadcrumb: 'Articles' }),
    component: route => (
        <ListPage
            pageId="article-list"
            title="Articles"
            listQuery={getArticleList}
            deleteMutation={deleteArticleDocument}
            route={route}
            customizeColumns={{
                title: {
                    cell: ({ row }) => {
                        const article = row.original;
                        return <DetailPageButton id={article.id} label={article.title} />;
                    },
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
            <ActionBarItem itemId="new-article">
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    New article
                </Button>
            </ActionBarItem>
        </ListPage>
    ),
};
