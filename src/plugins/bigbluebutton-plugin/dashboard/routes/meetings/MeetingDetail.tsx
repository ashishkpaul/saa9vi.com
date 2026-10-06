import { useQuery } from '@tanstack/react-query';
import {
    api,
    Badge,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Skeleton,
    DashboardRouteDefinition,
    Link,
} from '@vendure/dashboard';
import type { AnyRoute } from '@vendure/dashboard';
import { graphql } from '@/gql';

// ─── S5 tenant meeting detail (/bbb/meetings/$id) ─────────────────────────────
// SessionDetail has always linked here ("View Meeting Detail ->") but no route
// was ever registered — this page both fulfils that link and is the tenant
// surface for the W5 audit trail (startedByUserId / endedByUserId, new rows
// only: null = system origin / system end). Server-side the read goes through
// bbbMeeting(id) -> findById -> assertMeetingAccess, so a tenant can only ever
// see its own channel's meeting (INV-001 / Channel=Tenant).

const STATE_BADGE: Record<string, 'success' | 'warning' | 'default' | 'destructive'> = {
    Pending: 'warning',
    Provisioning: 'warning',
    Active: 'success',
    Completed: 'default',
    Archived: 'default',
    Failed: 'destructive',
};

const GET_MEETING = graphql(`
  query GetBbbMeetingDetail($id: ID!) {
    bbbMeeting(id: $id) {
      id
      title
      state
      createdAt
      provisionedAt
      completedAt
      startedByUserId
      endedByUserId
      recordingEnabled
      billingCapped
      billingCapReason
      organization { id name slug }
    }
  }
`);

interface BbbMeetingDetail {
    id: string;
    title: string;
    state: string;
    createdAt: string;
    provisionedAt: string | null;
    completedAt: string | null;
    startedByUserId: string | null;
    endedByUserId: string | null;
    recordingEnabled: boolean;
    billingCapped: boolean;
    billingCapReason: string | null;
    organization: { id: string; name: string; slug: string };
}

interface MeetingResponse {
    bbbMeeting: BbbMeetingDetail | null;
}

export const meetingDetail: DashboardRouteDefinition = {
    path: '/bbb/meetings/$id',
    component: (route) => <MeetingDetailPage route={route} />,
};

function formatWhen(at: string | null): string {
    return at ? new Date(at).toLocaleString() : '—';
}

function MeetingDetailPage({ route }: { route: AnyRoute }) {
    const params = route.useParams();
    const id = params.id;

    const { data, isLoading, isError } = useQuery<MeetingResponse>({
        queryKey: ['bbbMeeting', id],
        queryFn: () => api.query(GET_MEETING, { id }),
        enabled: !!id,
    });

    const meeting = data?.bbbMeeting ?? null;

    if (isLoading) {
        return (
            <div className="p-6 space-y-4">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-40 w-full" />
            </div>
        );
    }

    if (isError || !meeting) {
        return (
            <div className="p-6">
                <div className="mb-4">
                    <Link to="/bbb/meetings" className="text-sm text-blue-500 hover:underline">&larr; Back to Meetings</Link>
                </div>
                <Card>
                    <div className="p-6 text-center text-red-500">
                        {isError ? 'Failed to load meeting' : 'Meeting not found'}
                    </div>
                </Card>
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="mb-4">
                <Link to="/bbb/meetings" className="text-sm text-blue-500 hover:underline">&larr; Back to Meetings</Link>
            </div>

            <div className="mb-6 flex items-center gap-3">
                <h1 className="text-2xl font-bold">{meeting.title}</h1>
                <Badge variant={STATE_BADGE[meeting.state] ?? 'default'}>{meeting.state}</Badge>
                {meeting.billingCapped && <Badge variant="outline">capped</Badge>}
            </div>

            {/* W5 audit trail — the reason this page exists for the tenant. */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>Audit trail</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Started by</span>
                        {meeting.startedByUserId ? (
                            <code className="text-xs">{meeting.startedByUserId}</code>
                        ) : (
                            <span className="text-sm italic text-muted-foreground">System / not recorded</span>
                        )}
                    </div>
                    <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Ended by</span>
                        {meeting.endedByUserId ? (
                            <code className="text-xs">{meeting.endedByUserId}</code>
                        ) : (
                            <span className="text-sm italic text-muted-foreground">System / not recorded</span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Recorded for meetings created after the audit-trail rollout; null means a
                        system start (queue provisioning) or a system end (webhook / reconciliation).
                    </p>
                </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>When</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Created</span>
                            <span className="text-sm font-medium">{formatWhen(meeting.createdAt)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Started</span>
                            <span className="text-sm font-medium">{formatWhen(meeting.provisionedAt)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Completed</span>
                            <span className="text-sm font-medium">{formatWhen(meeting.completedAt)}</span>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Organization</span>
                            <span className="text-sm font-medium">
                                {meeting.organization.name} ({meeting.organization.slug})
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Recording</span>
                            <Badge variant={meeting.recordingEnabled ? 'success' : 'warning'}>
                                {meeting.recordingEnabled ? 'Enabled' : 'Disabled'}
                            </Badge>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Billing capped</span>
                            <span className="text-sm font-medium">{meeting.billingCapped ? 'Yes' : 'No'}</span>
                        </div>
                        {meeting.billingCapped && meeting.billingCapReason && (
                            <p className="text-xs text-muted-foreground">{meeting.billingCapReason}</p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
