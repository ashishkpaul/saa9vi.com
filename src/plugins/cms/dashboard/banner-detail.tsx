import {
    ActionBarItem,
    Button,
    CustomFieldsPageBlock,
    DashboardRouteDefinition,
    DateTimeInput,
    DetailFormGrid,
    FormFieldWrapper,
    Input,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
    ResultOf,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SingleRelationInput,
    Switch,
    api,
    createRelationSelectorConfig,
    detailPageRouteLoader,
    toast,
    useDetailPage,
    useNavigate,
} from '@vendure/dashboard';
import type { AnyRoute } from '@vendure/dashboard';
import { graphql } from '@/gql';
import { ChannelMultiSelect } from './components/channel-multiselect';
import { useState } from 'react';

const bannerDetailDocument = graphql(`
    query GetBannerDetail($id: ID!) {
        banner(id: $id) {
            id
            createdAt
            updatedAt
            title
            linkUrl
            placement
            priority
            isActive
            startsAt
            endsAt
            customFields
            image {
                id
                preview
            }
            channels {
                id
                code
            }
        }
    }
`);

const createBannerDocument = graphql(`
    mutation CreateBanner($input: CreateBannerInput!) {
        createBanner(input: $input) {
            id
        }
    }
`);

const updateBannerDocument = graphql(`
    mutation UpdateBanner($input: UpdateBannerInput!) {
        updateBanner(input: $input) {
            id
        }
    }
`);

// Powers the asset picker for the banner's `image` field — search/select
// from existing Assets the same way the rest of the catalog UI does.
const assetListQuery = graphql(`
    query GetAssetsForBannerSelection($options: AssetListOptions) {
        assets(options: $options) {
            items {
                id
                name
                preview
            }
            totalItems
        }
    }
`);

const assetSelectorConfig = createRelationSelectorConfig<ResultOf<typeof assetListQuery>['assets']['items'][0]>({
    listQuery: assetListQuery,
    idKey: 'id',
    labelKey: 'name',
    placeholder: 'Search assets...',
});

const PLACEMENTS = [
    'HOMEPAGE_HERO',
    'HOMEPAGE_STRIP',
    'CATEGORY_TOP',
    'SIDEBAR',
    'CHECKOUT_PROMO',
] as const;

export const bannerDetail: DashboardRouteDefinition = {
    path: '/banners/$id',
    loader: detailPageRouteLoader({
        queryDocument: bannerDetailDocument,
        breadcrumb: (isNew, entity) => [
            { path: '/banners', label: 'Banners' },
            isNew ? 'New banner' : entity?.title,
        ],
    }),
    component: route => <BannerDetailPage route={route} />,
};

function BannerDetailPage({ route }: { route: AnyRoute }) {
    const params = route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === 'new';
    const [extraChannelIds, setExtraChannelIds] = useState<string[]>([]);

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        queryDocument: bannerDetailDocument,
        createDocument: createBannerDocument,
        updateDocument: updateBannerDocument,
        setValuesForUpdate: banner => ({
            id: banner?.id ?? '',
            title: banner?.title ?? '',
            linkUrl: banner?.linkUrl ?? '',
            placement: banner?.placement ?? 'HOMEPAGE_HERO',
            priority: banner?.priority ?? 0,
            isActive: banner?.isActive ?? true,
            startsAt: banner?.startsAt ?? null,
            endsAt: banner?.endsAt ?? null,
            imageId: banner?.image?.id ?? '',
        }),
        params: { id: params.id },
        onSuccess: async data => {
            if (extraChannelIds.length) {
                try {
                    await api.mutate(updateBannerDocument, {
                        input: { id: data.id, channelIds: extraChannelIds },
                    });
                } catch (err) {
                    toast('Banner saved, but channel assignment failed', {
                        description: err instanceof Error ? err.message : 'Unknown error',
                    });
                }
            }
            toast('Successfully saved banner');
            resetForm();
            if (creatingNewEntity) {
                await navigate({ to: `/banners/${data.id}` });
            }
        },
        onError: err => {
            toast('Failed to save banner', {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    return (
        <Page pageId="banner-detail" form={form} submitHandler={submitHandler}>
            <PageTitle>{creatingNewEntity ? 'New banner' : (entity?.title ?? '')}</PageTitle>
            <PageActionBar>
                <ActionBarItem requiresPermission={['CreateCmsBanner', 'UpdateCmsBanner']} itemId="save-button">
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                    >
                        {creatingNewEntity ? 'Create' : 'Update'}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="side" blockId="active-status">
                    <FormFieldWrapper
                        control={form.control}
                        name="isActive"
                        label="Active"
                        render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                        )}
                    />
                </PageBlock>

                <PageBlock column="side" blockId="schedule">
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="startsAt"
                            label="Starts at"
                            description="Leave blank to show immediately"
                            render={({ field }) => (
                                <DateTimeInput {...field} value={field.value} />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="endsAt"
                            label="Ends at"
                            description="Leave blank to run indefinitely"
                            render={({ field }) => (
                                <DateTimeInput {...field} value={field.value} />
                            )}
                        />
                    </DetailFormGrid>
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
                            description="Internal label, not shown to customers"
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="linkUrl"
                            label="Link URL"
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="placement"
                            label="Placement"
                            render={({ field }) => (
                                <Select value={field.value} onValueChange={field.onChange}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PLACEMENTS.map(p => (
                                            <SelectItem key={p} value={p}>
                                                {p}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="priority"
                            label="Priority"
                            description="Lower number shows first when multiple banners share a placement"
                            render={({ field }) => (
                                <Input
                                    type="number"
                                    {...field}
                                    onChange={e => field.onChange(Number(e.target.value))}
                                />
                            )}
                        />
                    </DetailFormGrid>
                    <FormFieldWrapper
                        control={form.control}
                        name="imageId"
                        label="Image"
                        render={({ field }) => (
                            <SingleRelationInput {...field} config={assetSelectorConfig} />
                        )}
                    />
                </PageBlock>

                <CustomFieldsPageBlock column="main" entityType="Banner" control={form.control} />
            </PageLayout>
        </Page>
    );
}
