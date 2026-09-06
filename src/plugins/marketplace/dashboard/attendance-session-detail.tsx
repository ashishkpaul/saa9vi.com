import { DashboardRouteDefinition, ListPage } from '@vendure/dashboard';
import { graphql } from '@/gql';

const getSessionAttendance = graphql(`
    query SessionAttendance($sessionId: ID!) {
        scheduledSessionAttendance(sessionId: $sessionId) {
            id
            customerId
            customerName
            customerEmail
            attendanceStatus
            joinedAt
            leftAt
            totalDurationSeconds
            cyclesCount
            source
            lastEventAt
        }
    }
`);

export const createAttendanceSessionDetail = (sessionId: string): DashboardRouteDefinition => ({
    path: `/attendance/session/${sessionId}`,
    loader: () => ({ breadcrumb: `Session ${sessionId}` }),
    component: () => (
        <ListPage
            pageId={`attendance-session-${sessionId}`}
            title={`Session Attendance: ${sessionId}`}
            listQuery={getSessionAttendance}
            variables={{ sessionId }}
            customizeColumns={{
                customerName: {
                    header: 'Student',
                    cell: ({ row }) => row.original.customerName ?? row.original.customerId,
                },
                customerEmail: {
                    header: 'Email',
                    cell: ({ row }) => row.original.customerEmail ?? '—',
                },
                attendanceStatus: {
                    header: 'Status',
                    cell: ({ row }) => row.original.attendanceStatus,
                },
                joinedAt: {
                    header: 'Joined',
                    cell: ({ row }) => row.original.joinedAt ? new Date(row.original.joinedAt).toLocaleString() : '—',
                },
                leftAt: {
                    header: 'Left',
                    cell: ({ row }) => row.original.leftAt ? new Date(row.original.leftAt).toLocaleString() : '—',
                },
                totalDurationSeconds: {
                    header: 'Duration (s)',
                    cell: ({ row }) => row.original.totalDurationSeconds,
                },
                cyclesCount: {
                    header: 'Cycles',
                    cell: ({ row }) => row.original.cyclesCount,
                },
                source: {
                    header: 'Source',
                    cell: ({ row }) => row.original.source,
                },
            }}
        />
    ),
});
