import {
    ActionBarItem,
    Button,
    CustomFieldsPageBlock,
    DashboardRouteDefinition,
    DetailFormGrid,
    FormFieldWrapper,
    Input,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
    RichTextInput,
    Switch,
    Textarea,
    api,
    detailPageRouteLoader,
    toast,
    useDetailPage,
    useNavigate,
} from '@vendure/dashboard';
import type { AnyRoute } from '@vendure/dashboard';
import { graphql } from '@/gql';
import { ChannelMultiSelect } from './components/channel-multiselect';
import { useState } from 'react';

const articleDetailDocument = graphql(`
    query GetArticleDetail($id: ID!) {
        article(id: $id) {
            id
            createdAt
            updatedAt
            isPublished
            title
            slug
            excerpt
            body
            tags
            customFields
            channels {
                id
                code
            }
        }
    }
`);

const createArticleDocument = graphql(`
    mutation CreateArticle($input: CreateArticleInput!) {
        createArticle(input: $input) {
            id
        }
    }
`);

const updateArticleDocument = graphql(`
    mutation UpdateArticle($input: UpdateArticleInput!) {
        updateArticle(input: $input) {
            id
        }
    }
`);

export const articleDetail: DashboardRouteDefinition = {
    path: '/articles/$id',
    loader: detailPageRouteLoader({
        queryDocument: articleDetailDocument,
        breadcrumb: (isNew, entity) => [
            { path: '/articles', label: 'Articles' },
            isNew ? 'New article' : entity?.title,
        ],
    }),
    component: route => <ArticleDetailPage route={route} />,
};

function ArticleDetailPage({ route }: { route: AnyRoute }) {
    const params = route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === 'new';
    const [extraChannelIds, setExtraChannelIds] = useState<string[]>([]);

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        queryDocument: articleDetailDocument,
        createDocument: createArticleDocument,
        updateDocument: updateArticleDocument,
        setValuesForUpdate: article => ({
            id: article?.id ?? '',
            isPublished: article?.isPublished ?? false,
            title: article?.title ?? '',
            slug: article?.slug ?? '',
            excerpt: article?.excerpt ?? '',
            body: article?.body ?? '',
            tags: article?.tags ?? [],
        }),
        params: { id: params.id },
        onSuccess: async data => {
            // Channel assignment is sent as a deliberate follow-up call rather
            // than folded into the main create/update mutation input, since
            // useDetailPage's form schema is derived from setValuesForUpdate
            // and we don't want to assume it passes through fields outside
            // that shape. createArticle/updateArticle both accept
            // `channelIds` directly, so this is just a second, explicit call.
            if (extraChannelIds.length) {
                try {
                    await api.mutate(updateArticleDocument, {
                        input: { id: data.id, channelIds: extraChannelIds },
                    });
                } catch (err) {
                    toast('Article saved, but channel assignment failed', {
                        description: err instanceof Error ? err.message : 'Unknown error',
                    });
                }
            }
            toast('Successfully saved article');
            resetForm();
            if (creatingNewEntity) {
                await navigate({ to: `/articles/${data.id}` });
            }
        },
        onError: err => {
            toast('Failed to save article', {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    return (
        <Page pageId="article-detail" form={form} submitHandler={submitHandler}>
            <PageTitle>{creatingNewEntity ? 'New article' : (entity?.title ?? '')}</PageTitle>
            <PageActionBar>
                <ActionBarItem requiresPermission={['CreateCmsArticle', 'UpdateCmsArticle']} itemId="save-button">
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                    >
                        {creatingNewEntity ? 'Create' : 'Update'}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="side" blockId="publish-status">
                    <FormFieldWrapper
                        control={form.control}
                        name="isPublished"
                        label="Published"
                        render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                        )}
                    />
                </PageBlock>

                <PageBlock column="side" blockId="channel-scope">
                    {/*
                        On create, the article is auto-assigned to the channel the
                        admin is currently in (handled server-side via
                        ChannelService.assignToCurrentChannel). This control is
                        only for *additional* channels — e.g. a platform admin
                        publishing the same article into several seller channels.
                    */}
                    <ChannelMultiSelect
                        assignedChannels={entity?.channels}
                        value={extraChannelIds}
                        onChange={setExtraChannelIds}
                    />
                </PageBlock>

                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="title"
                            label="Title"
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="slug"
                            label="Slug"
                            description="Unique within this channel; used in the storefront URL"
                            render={({ field }) => <Input {...field} />}
                        />
                    </DetailFormGrid>
                    <FormFieldWrapper
                        control={form.control}
                        name="excerpt"
                        label="Excerpt"
                        render={({ field }) => <Textarea {...field} rows={2} />}
                    />
                    <FormFieldWrapper
                        control={form.control}
                        name="body"
                        label="Content"
                        render={({ field }) => (
                            <RichTextInput {...field} value={field.value ?? ''} />
                        )}
                    />
                </PageBlock>

                <CustomFieldsPageBlock column="main" entityType="Article" control={form.control} />
            </PageLayout>
        </Page>
    );
}
