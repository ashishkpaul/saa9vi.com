import { useQuery } from '@tanstack/react-query';
import { api, Badge, Card, Skeleton } from '@vendure/dashboard';
import { graphql } from '@/gql';
import { Link } from '@vendure/dashboard';
import { useCurrentOrganization } from '../../shared/useCurrentOrganization';
import { formatPaiseInr } from '../../../shared/format';

// ─── S6 (Phase 6 UX completion) — tenant Dashboard ──────────────────────────
// The 5th locked tenant nav item (Dashboard, Rooms, Meetings, People, Billing).
// Aggregates existing queries only (no backend change): live rooms now, the
// month summary and the org's upcoming sessions. Legacy sessions with a null
// roomId surface here (they have no room screen to live under — Phase 6 §3.3).
// No plumbing: no meeting ids, no provisioning states, no retry counts (A11).
// Money is integer paise on the wire and formatted only at this edge (ADR-047).
// Typed graphql() (A24).

const DASHBOARD_ROOMS = graphql(`
  query BbbTenantDashboardRooms($organizationId: ID!, $options: BbbRoomListOptions) {
    bbbRooms(organizationId: $organizationId, options: $options) {
      items {
        id
        name
        state
        studentCount
      }
      totalItems
    }
  }
`);

const DASHBOARD_BILLING = graphql(`
  query BbbTenantDashboardBilling($month: String) {
    bbbBillingSummary(month: $month) {
      month
      ratePaisePerHour
      totalLearnerMinutes
      totalChargePaise
      spendLimitPaise
      spendLimitReached
    }
  }
`);

const DASHBOARD_SESSIONS = graphql(`
  query BbbTenantDashboardSessions($organizationId: ID!) {
    bbbScheduledSessions(organizationId: $organizationId) {
      id
      title
      startTime
      endTime
      status
      roomId
    }
  }
`);

interface RoomRow {
  id: string;
  name: string;
  state: string;
  studentCount?: number | null;
}

interface SessionRow {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  roomId: string | null;
}

/** Current UTC month as YYYY-MM — mirrors the server's default period month. */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function toStudentHours(learnerMinutes: number): string {
  return `${(learnerMinutes / 60).toFixed(1)} h`;
}

export function DashboardOverview() {
  const { organizationId, label, isLoading: orgLoading } = useCurrentOrganization();
  const month = currentMonth();

  const roomsQuery = useQuery({
    queryKey: ['bbbDashboardRooms', organizationId],
    queryFn: () => api.query(DASHBOARD_ROOMS, { organizationId, options: { take: 100 } }),
    enabled: !!organizationId,
  });
  const billingQuery = useQuery({
    queryKey: ['bbbDashboardBilling', month],
    queryFn: () => api.query(DASHBOARD_BILLING, { month }),
  });
  const sessionsQuery = useQuery({
    queryKey: ['bbbDashboardSessions', organizationId],
    queryFn: () => api.query(DASHBOARD_SESSIONS, { organizationId }),
    enabled: !!organizationId,
  });

  const rooms: RoomRow[] = (roomsQuery.data as any)?.bbbRooms?.items ?? [];
  const billing = (billingQuery.data as any)?.bbbBillingSummary ?? null;
  const sessions: SessionRow[] = (sessionsQuery.data as any)?.bbbScheduledSessions ?? [];

  const liveRooms = rooms.filter((r) => r.state === 'Active');
  const now = Date.now();
  // Upcoming = not cancelled and not already started, soonest first. A session
  // with a null roomId is a legacy row (created before the room-centric model):
  // it is shown here with a hint because no room screen can own it.
  const upcoming = sessions
    .filter((s) => s.status !== 'CANCELLED' && new Date(s.startTime).getTime() >= now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 10);

  if (orgLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {label || 'No organization is bound to this channel'}
        </p>
      </div>

      {!organizationId ? (
        <Card><div className="p-6 text-center text-muted-foreground">No organization is bound to this channel</div></Card>
      ) : (
        <div className="grid gap-6">
          {billing?.spendLimitReached && (
            <Card>
              <div className="p-4 text-sm text-destructive">
                This month has reached the account's spend limit — starting new classes is paused
                until the limit is raised or the month ends.
              </div>
            </Card>
          )}
          {/* ─── Live now ─────────────────────────────────────────────────── */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Live now</h2>
              <Link to="/bbb/rooms" className="text-sm text-blue-500 hover:underline">All rooms</Link>
            </div>
            <Card>
              {roomsQuery.isLoading ? (
                <div className="p-4 space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : roomsQuery.isError ? (
                <div className="p-6 text-center text-red-500">Failed to load rooms</div>
              ) : liveRooms.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  No class is running right now. Start one from{' '}
                  <Link to="/bbb/rooms" className="text-blue-500 hover:underline">Rooms</Link>.
                </div>
              ) : (
                <div className="divide-y">
                  {liveRooms.map((room) => (
                    <div key={room.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <div className="font-medium">{room.name}</div>
                        <div className="text-sm text-muted-foreground">{room.studentCount ?? 0} students enrolled</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="success"><span className="mr-1">●</span>Live</Badge>
                        <Link to={`/bbb/rooms/${room.id}`} className="text-sm text-blue-500 hover:underline">Open room</Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* ─── This month ───────────────────────────────────────────────── */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">This month</h2>
              <Link to="/bbb/billing" className="text-sm text-blue-500 hover:underline">Billing</Link>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <div className="p-6">
                  <div className="text-sm text-muted-foreground">Rate</div>
                  <div className="text-2xl font-bold">
                    {billing ? `${formatPaiseInr(billing.ratePaisePerHour)} / student-hour` : <Skeleton className="h-8 w-32" />}
                  </div>
                </div>
              </Card>
              <Card>
                <div className="p-6">
                  <div className="text-sm text-muted-foreground">Student-hours</div>
                  <div className="text-2xl font-bold">
                    {billing ? toStudentHours(billing.totalLearnerMinutes) : <Skeleton className="h-8 w-24" />}
                  </div>
                </div>
              </Card>
              <Card>
                <div className="p-6">
                  <div className="text-sm text-muted-foreground">Charge</div>
                  <div className="text-2xl font-bold">
                    {billing ? formatPaiseInr(billing.totalChargePaise) : <Skeleton className="h-8 w-24" />}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {billing?.spendLimitPaise != null
                      ? `Spend limit ${formatPaiseInr(billing.spendLimitPaise)}`
                      : 'No spend limit'}
                  </div>
                </div>
              </Card>
            </div>
          </div>
          {/* ─── Upcoming sessions ────────────────────────────────────────── */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">Upcoming sessions</h2>
            <Card>
              {sessionsQuery.isLoading ? (
                <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : sessionsQuery.isError ? (
                <div className="p-6 text-center text-red-500">Failed to load sessions</div>
              ) : upcoming.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">Nothing scheduled. Schedule a class from a room's Sessions tab.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Session</th>
                        <th className="px-4 py-3 font-medium">Starts</th>
                        <th className="px-4 py-3 font-medium">Ends</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcoming.map((s) => (
                        <tr key={s.id} className="border-b last:border-0">
                          <td className="px-4 py-3 font-medium">
                            {s.roomId ? (
                              <Link to={`/bbb/rooms/${s.roomId}`} className="text-blue-500 hover:underline">{s.title}</Link>
                            ) : (
                              <>
                                {s.title}
                                <Badge variant="outline" className="ml-2">no room</Badge>
                              </>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{new Date(s.startTime).toLocaleString()}</td>
                          <td className="px-4 py-3 text-muted-foreground">{new Date(s.endTime).toLocaleString()}</td>
                          <td className="px-4 py-3"><Badge variant="outline">{s.status}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

