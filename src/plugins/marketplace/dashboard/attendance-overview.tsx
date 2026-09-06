import { DashboardRouteDefinition, Page, PageBlock, PageLayout, PageTitle } from '@vendure/dashboard';
import { api } from '@vendure/dashboard';
import { useQuery } from '@tanstack/react-query';

const GET_CHANNEL_ATTENDANCE_SUMMARY = `
    query ChannelAttendanceSummary($from: DateTime!, $to: DateTime!) {
        channelAttendanceSummary(from: $from, to: $to) {
            totalSessions
            totalRegistered
            totalAttended
            totalNoShow
            attendanceRate
            averageDurationSeconds
            completionRate
        }
    }
`;

function MetricCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border p-4">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold">{value}</div>
        </div>
    );
}

export const attendanceOverview: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketplace',
        id: 'attendance-overview',
        url: '/attendance',
        title: 'Attendance',
        requiresPermission: ['BbbManageSessions'],
    },
    path: '/attendance',
    loader: () => ({ breadcrumb: 'Attendance' }),
    component: () => {
        const from = new Date(Date.now() - 30 * 86400000).toISOString();
        const to = new Date().toISOString();

        const { data, isLoading, error } = useQuery({
            queryKey: ['channelAttendanceSummary', from, to],
            queryFn: () => api.query(GET_CHANNEL_ATTENDANCE_SUMMARY, { from, to }),
        });

        const summary = (data as any)?.channelAttendanceSummary;

        if (isLoading) {
            return (
                <Page>
                    <PageTitle>Channel Attendance</PageTitle>
                    <p className="text-muted-foreground">Loading attendance data...</p>
                </Page>
            );
        }

        if (error) {
            return (
                <Page>
                    <PageTitle>Channel Attendance</PageTitle>
                    <p className="text-destructive">Error loading attendance summary: {(error as any).message}</p>
                </Page>
            );
        }

        if (!summary) {
            return (
                <Page>
                    <PageTitle>Channel Attendance</PageTitle>
                    <p className="text-muted-foreground">No attendance data available.</p>
                </Page>
            );
        }

        return (
            <Page>
                <PageTitle>
                    <div className="flex items-center gap-3">
                        <span>Channel Attendance</span>
                        <span className="text-sm text-muted-foreground">Last 30 days</span>
                    </div>
                </PageTitle>

                <PageLayout>
                    <PageBlock column="main" blockId="attendance-overview">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                            <MetricCard label="Sessions" value={String(summary.totalSessions)} />
                            <MetricCard label="Registered" value={String(summary.totalRegistered)} />
                            <MetricCard label="Attended" value={String(summary.totalAttended)} />
                            <MetricCard label="No Show" value={String(summary.totalNoShow)} />
                            <MetricCard
                                label="Attendance Rate"
                                value={`${(summary.attendanceRate * 100).toFixed(1)}%`}
                            />
                            <MetricCard
                                label="Avg Duration (s)"
                                value={Number(summary.averageDurationSeconds).toFixed(0)}
                            />
                            <MetricCard
                                label="Completion Rate"
                                value={`${(summary.completionRate * 100).toFixed(1)}%`}
                            />
                        </div>
                    </PageBlock>
                </PageLayout>
            </Page>
        );
    },
};
