import { DashboardRouteDefinition, ListPage } from '@vendure/dashboard';
import { graphql } from '@/gql';

const getChannelAttendanceSummary = graphql(`
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
`);

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

        return (
            <ListPage
                pageId="attendance-overview"
                title="Channel Attendance"
                listQuery={getChannelAttendanceSummary}
                variables={{ from, to }}
                customizeColumns={{
                    totalSessions: {
                        header: 'Sessions',
                        cell: ({ row }) => row.original.totalSessions,
                    },
                    totalRegistered: {
                        header: 'Registered',
                        cell: ({ row }) => row.original.totalRegistered,
                    },
                    totalAttended: {
                        header: 'Attended',
                        cell: ({ row }) => row.original.totalAttended,
                    },
                    totalNoShow: {
                        header: 'No Show',
                        cell: ({ row }) => row.original.totalNoShow,
                    },
                    attendanceRate: {
                        header: 'Attendance Rate',
                        cell: ({ row }) => `${(row.original.attendanceRate * 100).toFixed(1)}%`,
                    },
                    averageDurationSeconds: {
                        header: 'Avg Duration (s)',
                        cell: ({ row }) => row.original.averageDurationSeconds.toFixed(0),
                    },
                    completionRate: {
                        header: 'Completion Rate',
                        cell: ({ row }) => `${(row.original.completionRate * 100).toFixed(1)}%`,
                    },
                }}
            />
        );
    },
};
