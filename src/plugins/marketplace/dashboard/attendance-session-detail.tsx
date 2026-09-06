import { DashboardRouteDefinition, Page, PageBlock, PageLayout, PageTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';
import { api } from '@vendure/dashboard';
import { useQuery } from '@tanstack/react-query';

const GET_SESSION_ATTENDANCE = `
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
`;

function formatDate(date: string | null): string {
    return date ? new Date(date).toLocaleString() : '—';
}

export const attendanceSessionDetail: DashboardRouteDefinition = {
    path: '/attendance/session/$id',
    loader: () => ({ breadcrumb: 'Session Attendance' }),
    component: ({ route }: { route: any }) => <AttendanceSessionDetailPage route={route} />,
};

function AttendanceSessionDetailPage({ route }: { route: any }) {
    const sessionId = route.useParams().id as string;

    const { data, isLoading, error } = useQuery({
        queryKey: ['sessionAttendance', sessionId],
        queryFn: () => api.query(GET_SESSION_ATTENDANCE, { sessionId }),
    });

    const records = (data as any)?.scheduledSessionAttendance ?? [];

        if (isLoading) {
            return (
                <Page>
                    <PageTitle>Session Attendance</PageTitle>
                    <p className="text-muted-foreground">Loading attendance records...</p>
                </Page>
            );
        }

        if (error) {
            return (
                <Page>
                    <PageTitle>Session Attendance</PageTitle>
                    <p className="text-destructive">Error loading attendance: {(error as any).message}</p>
                </Page>
            );
        }

        return (
            <Page>
                <PageTitle>
                    <div className="flex items-center gap-3">
                        <span>Session Attendance</span>
                        <span className="text-sm text-muted-foreground">{sessionId}</span>
                    </div>
                </PageTitle>

                <PageLayout>
                    <PageBlock column="main" blockId="session-attendance">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Student</TableHead>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Joined</TableHead>
                                    <TableHead>Left</TableHead>
                                    <TableHead>Duration (s)</TableHead>
                                    <TableHead>Cycles</TableHead>
                                    <TableHead>Source</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {records.map((r: any) => (
                                    <TableRow key={r.id}>
                                        <TableCell>{r.customerName ?? r.customerId}</TableCell>
                                        <TableCell>{r.customerEmail ?? '—'}</TableCell>
                                        <TableCell>{r.attendanceStatus}</TableCell>
                                        <TableCell>{formatDate(r.joinedAt)}</TableCell>
                                        <TableCell>{formatDate(r.leftAt)}</TableCell>
                                        <TableCell>{r.totalDurationSeconds}</TableCell>
                                        <TableCell>{r.cyclesCount}</TableCell>
                                        <TableCell>{r.source}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </PageBlock>
                </PageLayout>
            </Page>
        );
}

