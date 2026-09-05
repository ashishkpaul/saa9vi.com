import {
  ActionBarItem,
  Badge,
  Button,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  api,
  detailPageRouteLoader,
  toast,
  useDetailPage,
  useNavigate,
} from '@vendure/dashboard';
import type { AnyRoute } from '@vendure/dashboard';
import { graphql } from '@/gql';
import { PlusIcon } from 'lucide-react';

const campaignDetailDocument = graphql(`
    query GetCampaignDetail($id: ID!) {
        campaign(id: $id) {
            id
            channelId
            type
            status
            budgetInPaise
            spentInPaise
            targetSessionId
            targetSubject
            targetCity
            startsAt
            endsAt
            boostWeight
            createdAt
            updatedAt
        }
    }
`);

const createCampaignDocument = graphql(`
    mutation CreateCampaign($input: CreateCampaignInput!) {
        createCampaign(input: $input) {
            id
        }
    }
`);

const updateCampaignDocument = graphql(`
    mutation UpdateCampaign($id: ID!, $input: UpdateCampaignInput!) {
        updateCampaign(id: $id, input: $input) {
            id
        }
    }
`);

const activateCampaignDocument = graphql(`
    mutation ActivateCampaign($id: ID!) {
        activateCampaign(id: $id) {
            id
            status
        }
    }
`);

const pauseCampaignDocument = graphql(`
    mutation PauseCampaign($id: ID!) {
        pauseCampaign(id: $id) {
            id
            status
        }
    }
`);

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    active: 'default',
    paused: 'secondary',
    draft: 'outline',
    exhausted: 'destructive',
};

const CAMPAIGN_TYPES = [
    { value: 'sponsored_listing', label: 'Sponsored Listing' },
    { value: 'banner', label: 'Banner' },
] as const;

function formatPaise(paise: number): string {
    return `₹${(paise / 100).toFixed(2)}`;
}

export const campaignDetail: DashboardRouteDefinition = {
    path: '/ad-campaigns/$id',
    loader: detailPageRouteLoader({
        queryDocument: campaignDetailDocument,
        breadcrumb: (isNew, entity) => [
            { path: '/ad-campaigns', label: 'Ad Campaigns' },
            isNew ? 'New campaign' : `Campaign ${entity?.id ?? ''}`,
        ],
    }),
    component: route => <CampaignDetailPage route={route} />,
};

function CampaignDetailPage({ route }: { route: AnyRoute }) {
    const params = route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === 'new';
    const campaignId = params.id;

    const { form, submitHandler, entity, isPending } = useDetailPage({
        queryDocument: campaignDetailDocument,
        createDocument: createCampaignDocument,
        updateDocument: updateCampaignDocument,
        transformInput: (input: any) => {
            const result: any = {};
            if (input.type) result.type = input.type;
            if (input.budgetInPaise != null) result.budgetInPaise = Number(input.budgetInPaise);
            if (input.targetSessionId) result.targetSessionId = input.targetSessionId;
            if (input.targetSubject) result.targetSubject = input.targetSubject;
            if (input.targetCity) result.targetCity = input.targetCity;
            if (input.startsAt) result.startsAt = input.startsAt;
            if (input.endsAt) result.endsAt = input.endsAt;
            if (input.boostWeight != null) result.boostWeight = Number(input.boostWeight);
            return result;
        },
        transformQuery: (entity: any) => ({
            type: entity.type ?? 'sponsored_listing',
            budgetInPaise: entity.budgetInPaise ?? 0,
            targetSessionId: entity.targetSessionId ?? '',
            targetSubject: entity.targetSubject ?? '',
            targetCity: entity.targetCity ?? '',
            startsAt: entity.startsAt ?? new Date().toISOString(),
            endsAt: entity.endsAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            boostWeight: entity.boostWeight ?? 3.0,
        }),
    });

    const { mutate: activateMutate, isPending: isActivating } = api.mutation(activateCampaignDocument);
    const { mutate: pauseMutate, isPending: isPausing } = api.mutation(pauseCampaignDocument);

    const handleActivate = async () => {
        try {
            await activateMutate({ id: campaignId });
            toast({ title: 'Campaign activated', variant: 'success' });
            navigate('/ad-campaigns');
        } catch (err: any) {
            toast({ title: 'Failed to activate', description: err.message, variant: 'error' });
        }
    };

    const handlePause = async () => {
        try {
            await pauseMutate({ id: campaignId });
            toast({ title: 'Campaign paused', variant: 'success' });
            navigate('/ad-campaigns');
        } catch (err: any) {
            toast({ title: 'Failed to pause', description: err.message, variant: 'error' });
        }
    };

    return (
        <Page>
            <PageTitle>
                <div className="flex items-center gap-3">
                    <span>{creatingNewEntity ? 'New Campaign' : `Campaign ${entity?.id ?? ''}`}</span>
                    {entity?.status && (
                        <Badge variant={STATUS_VARIANT[entity.status] ?? 'outline'}>
                            {entity.status}
                        </Badge>
                    )}
                </div>
            </PageTitle>

            <PageActionBar>
                {!creatingNewEntity && (isDraft || isPaused) && (
                    <ActionBarItem itemId="activate">
                        <Button onClick={handleActivate} disabled={isActivating}>
                            <PlusIcon className="mr-2 h-4 w-4" />
                            Activate
                        </Button>
                    </ActionBarItem>
                )}
                {!creatingNewEntity && isActive && (
                    <ActionBarItem itemId="pause">
                        <Button variant="outline" onClick={handlePause} disabled={isPausing}>
                            Pause
                        </Button>
                    </ActionBarItem>
                )}
            </PageActionBar>

            <form onSubmit={submitHandler}>
                <PageLayout>
                    <PageBlock column="main" blockId="main-form">
                        <DetailFormGrid>
                            <FormFieldWrapper
                                control={form.control}
                                name="type"
                                label="Campaign Type"
                                render={({ field }) => (
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {CAMPAIGN_TYPES.map(t => (
                                                <SelectItem key={t.value} value={t.value}>
                                                    {t.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="budgetInPaise"
                                label="Budget (paise)"
                                description="Total campaign budget in paise. Set to 0 for uncapped."
                                render={({ field }) => (
                                    <Input
                                        type="number"
                                        {...field}
                                        onChange={e => field.onChange(Number(e.target.value))}
                                    />
                                )}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="targetSubject"
                                label="Target Subject"
                                render={({ field }) => <Input {...field} />}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="targetCity"
                                label="Target City"
                                render={({ field }) => <Input {...field} />}
                            />

                            <FormFieldWrapper
                                control={form.control}
                                name="startsAt"
                                label="Starts At"
                                render={({ field }) => (
                                    <DateTimeInput {...field} value={field.value} />
                                )}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="endsAt"
                                label="Ends At"
                                render={({ field }) => (
                                    <DateTimeInput {...field} value={field.value} />
                                )}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="boostWeight"
                                label="Boost Weight"
                                description="Sponsored ranking boost factor (clamped by server config)"
                                render={({ field }) => (
                                    <Input
                                        type="number"
                                        step="0.1"
                                        {...field}
                                        onChange={e => field.onChange(Number(e.target.value))}
                                    />
                                )}
                            />
                        </DetailFormGrid>
                    </PageBlock>

                    {!creatingNewEntity && entity && (
                        <PageBlock column="side" blockId="campaign-stats">
                            <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                                Campaign Stats
                            </h3>
                            <dl className="space-y-2">
                                <div className="flex justify-between">
                                    <dt className="text-sm text-muted-foreground">Budget</dt>
                                    <dd className="text-sm font-medium">{formatPaise(entity.budgetInPaise ?? 0)}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-sm text-muted-foreground">Spent</dt>
                                    <dd className="text-sm font-medium">{formatPaise(entity.spentInPaise ?? 0)}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-sm text-muted-foreground">Channel</dt>
                                    <dd className="text-sm font-medium">{entity.channelId}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-sm text-muted-foreground">Created</dt>
                                    <dd className="text-sm font-medium">
                                        {entity.createdAt
                                            ? new Date(entity.createdAt).toLocaleDateString()
                                            : '—'}
                                    </dd>
                                </div>
                            </dl>
                        </PageBlock>
                    )}
                </PageLayout>
            </form>
        </Page>
    );
}

