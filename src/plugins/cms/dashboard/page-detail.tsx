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
import { PageSectionEditor } from './components/page-section-editor';
import { useState } from 'react';

/**
 * NOTE: `customFields` is deliberately NOT selected here.
 *
 * Vendure only attaches the `customFields: JSON` field to a GraphQL type whose
 * name matches a key in `config.customFields`. The CMS page entity declares its
 * custom-field config under its *class* name `Page` (`customFields: { Page: [] }`
 * in vendure-config.ts), while its GraphQL type is namespaced `CmsPage` (see
 * cms/api/api-extensions.ts). Those names do not match, so the Admin schema has
 * no `customFields` field on `CmsPage` and selecting it invalidates the whole
 * operation — which previously surfaced only as a blank detail form because the
 * error was collapsed into an empty dataset.
 *
 * `Article` and `Banner` are unaffected: their entity class names and GraphQL
 * type names match, so Vendure does attach `customFields` to them.
 *
 * `CustomFieldsPageBlock entityType="CmsPage"` below is still mounted; it renders
 * `null` while the server reports zero custom fields for the type.
 */
const cmsPageDetailDocument = graphql(`
    query GetCmsPageDetail($id: ID!) {
        cmsPage(id: $id) {
            id
            createdAt
            updatedAt
            title
            slug
            metaDescription
            isPublished
            sections
            channels {
                id
                code
            }
        }
    }
`);

const createPageDocument = graphql(`
    mutation CreatePage($input: CreatePageInput!) {
        createPage(input: $input) {
            id
        }
    }
`);

const updatePageDocument = graphql(`
    mutation UpdatePage($input: UpdatePageInput!) {
        updatePage(input: $input) {
            id
        }
    }
`);

export const pageDetail: DashboardRouteDefinition = {
    path: '/pages/$id',
    loader: detailPageRouteLoader({
        queryDocument: cmsPageDetailDocument,
        breadcrumb: (isNew, entity) => [
            { path: '/pages', label: 'Pages' },
            isNew ? 'New page' : entity?.title,
        ],
    }),
    component: route => <PageDetailPage route={route} />,
};

function PageDetailPage({ route }: { route: AnyRoute }) {
    const params = route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === 'new';
    const [extraChannelIds, setExtraChannelIds] = useState<string[]>([]);

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        queryDocument: cmsPageDetailDocument,
        createDocument: createPageDocument,
        updateDocument: updatePageDocument,
        setValuesForUpdate: page => ({
            id: page?.id ?? '',
            title: page?.title ?? '',
            slug: page?.slug ?? '',
            metaDescription: page?.metaDescription ?? '',
            isPublished: page?.isPublished ?? false,
            sections: page?.sections ?? [],
        }),
        params: { id: params.id },
        onSuccess: async data => {
            if (extraChannelIds.length) {
                try {
                    await api.mutate(updatePageDocument, {
                        input: { id: data.id, channelIds: extraChannelIds },
                    });
                } catch (err) {
                    toast('Page saved, but channel assignment failed', {
                        description: err instanceof Error ? err.message : 'Unknown error',
                    });
                }
            }
            toast('Successfully saved page');
            resetForm();
            if (creatingNewEntity) {
                await navigate({ to: `/pages/${data.id}` });
            }
        },
        onError: err => {
            toast('Failed to save page', {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    return (
        <Page pageId="page-detail" form={form} submitHandler={submitHandler}>
            <PageTitle>{creatingNewEntity ? 'New page' : (entity?.title ?? '')}</PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button">
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
                        name="metaDescription"
                        label="Meta description"
                        render={({ field }) => <Textarea {...field} rows={2} />}
                    />
                </PageBlock>

                <PageBlock column="main" blockId="sections">
                    <FormFieldWrapper
                        control={form.control}
                        name="sections"
                        label=""
                        render={({ field }) => (
                            <PageSectionEditor value={field.value ?? []} onChange={field.onChange} />
                        )}
                    />
                </PageBlock>

                <CustomFieldsPageBlock column="main" entityType="CmsPage" control={form.control} />
            </PageLayout>
        </Page>
    );
}
