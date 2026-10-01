import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Skeleton } from '@vendure/dashboard';
import type { DashboardRouteDefinition } from '@vendure/dashboard';
import type { AnyRoute } from '@vendure/dashboard';
import { graphql } from '@/gql';
import { toast } from 'sonner';
import { useState } from 'react';
import { Link } from '@vendure/dashboard';
import { useCurrentOrganization } from '../../shared/useCurrentOrganization';
import { formatPaiseInr } from '../../../shared/format';

// ─── S6 (Phase 6 UX completion) — Room detail ───────────────────────────────
// Room is the primary user-facing resource, so its detail screen carries the
// full locked tab set: Overview | People | Sessions | Attendance | Recordings |
// Settings.
//
// Everything here reads through existing Admin API documents (no backend
// change):
//   · Overview     — counts, rate, this month's usage/charge for this room,
//                    today's student-minutes, Start class (A22).
//   · People       — Trainers (org-wide, READ-ONLY: all academy trainers can
//                    teach in any room — D5, no per-room ACL) + Students
//                    (enrollments for this room, with access-until).
//   · Sessions     — bbbScheduledSessions(organizationId) filtered by
//                    session.roomId, plus a create dialog pre-filled with the
//                    room (Phase 6 §3.3).
//   · Attendance   — scheduledSessionAttendanceSummary per session of the room
//                    (Phase 5.6: derive sessions via roomId, reuse the existing
//                    per-session read — no new fact tables).
//   · Recordings   — the room's billed meetings carrying the recordingUrl the
//                    rap-publish-ended webhook stored (month-scoped; never
//                    invented).
//   · Settings     — name, max students, recording. No provisioning fields.
//
// No plumbing in the tenant document (A11): no currentMeetingId, retryCount,
// lastProvisionRequestedAt or server/grant ids. Typed graphql() (A24). There is
// no room-scoped metered read, so the month's rows are fetched once and
// filtered by roomId here.

const ROOM_DETAIL = graphql(`
  query BbbTenantRoomDetail($id: ID!) {
    bbbRoom(id: $id) {
      id
      name
      state
      recordingEnabled
      maxParticipants
      studentCount
    }
  }
`);

const ROOM_BILLING = graphql(`
  query BbbTenantRoomBilling($month: String) {
    bbbBillingSummary(month: $month) {
      month
      ratePaisePerHour
      byRoom {
        roomId
        learnerMinutes
        chargePaise
      }
    }
  }
`);

const ROOM_METERED = graphql(`
  query BbbTenantRoomMeteredMeetings($month: String, $take: Int) {
    bbbMeteredMeetings(month: $month, take: $take) {
      items {
        id
        title
        roomId
        startedAt
        completedAt
        peakLearners
        learnerMinutes
        chargePaise
        recordingUrl
      }
      totalItems
    }
  }
`);

const ROOM_SESSIONS = graphql(`
  query BbbTenantRoomSessions($organizationId: ID!) {
    bbbScheduledSessions(organizationId: $organizationId) {
      id
      title
      startTime
      endTime
      status
      visibility
      roomId
    }
  }
`);

const SESSION_ATTENDANCE = graphql(`
  query BbbTenantRoomSessionAttendance($sessionId: ID!) {
    scheduledSessionAttendanceSummary(sessionId: $sessionId) {
      sessionId
      registered
      attended
      noShow
      attendanceRate
      averageDurationSeconds
    }
  }
`);

const ROOM_TRAINERS = graphql(`
  query BbbTenantRoomTrainers($organizationId: ID!) {
    bbbOrganizationMembers(organizationId: $organizationId) {
      items {
        id
        customerId
        customerName
        customerEmail
        role
        active
      }
      totalItems
    }
  }
`);

const ROOM_STUDENTS = graphql(`
  query BbbTenantRoomStudents($roomId: ID!) {
    bbbEnrollmentsByRoom(roomId: $roomId) {
      items {
        id
        customerName
        customerEmail
        active
        validUntil
      }
      totalItems
    }
  }
`);

const START_ROOM = graphql(`
  mutation BbbRoomDetailStartRoom($roomId: ID!, $waitMs: Int) {
    bbbStartRoom(roomId: $roomId, waitMs: $waitMs) {
      status
      joinUrl
      roomState
      message
    }
  }
`);

const UPDATE_ROOM = graphql(`
  mutation BbbRoomDetailUpdate($id: ID!, $input: UpdateBbbRoomInput!) {
    updateBbbRoom(id: $id, input: $input) {
      id
      name
      recordingEnabled
      maxParticipants
    }
  }
`);

const SCHEDULE_SESSION = graphql(`
  mutation BbbRoomDetailScheduleSession($input: CreateBbbScheduledSessionInput!) {
    createBbbScheduledSession(input: $input) {
      id
      title
      startTime
      endTime
      status
      roomId
    }
  }
`);

const STATE_BADGE_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  Idle: 'default',
  Provisioning: 'warning',
  Active: 'success',
  Failed: 'destructive',
};

const STATE_LABEL: Record<string, string> = {
  Idle: 'Ready',
  Provisioning: 'Starting',
  Active: 'Live',
  Failed: 'Unavailable',
};

export const roomDetail: DashboardRouteDefinition = {
  path: '/bbb/rooms/$id',
  loader: () => ({ breadcrumb: 'Room detail' }),
  component: (route) => <RoomDetailPage route={route as AnyRoute} />,
};

type Tab = 'overview' | 'people' | 'sessions' | 'attendance' | 'recordings' | 'settings';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'people', label: 'People' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'recordings', label: 'Recordings' },
  { key: 'settings', label: 'Settings' },
];

/** Current UTC month as YYYY-MM — mirrors the server's default period month. */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function toStudentHours(learnerMinutes: number): string {
  return `${(learnerMinutes / 60).toFixed(1)} h`;
}

function toMinutes(seconds: number): string {
  if (!Number.isFinite(seconds)) return '\u2014';
  return `${(seconds / 60).toFixed(1)} min`;
}

/** Local-day equality — "today's usage" is a local-calendar question. */
function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  );
}

/** `<input type="datetime-local">` value (local, no timezone) → ISO instant. */
function toIso(localValue: string): string {
  return new Date(localValue).toISOString();
}

export function RoomDetailPage({ route }: { route: AnyRoute }) {
  const params = route.useParams() as { id: string };
  const id = params.id;
  const queryClient = useQueryClient();
  const { organizationId, label } = useCurrentOrganization();
  const [tab, setTab] = useState<Tab>('overview');
  const [month, setMonth] = useState(currentMonth());
  const [starting, setStarting] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);
  const [editMax, setEditMax] = useState<number | '' | null>(null);
  const [editRecording, setEditRecording] = useState<boolean | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [newTrainerId, setNewTrainerId] = useState('');

  const roomQuery = useQuery({
    queryKey: ['bbbRoom', id],
    queryFn: () => api.query(ROOM_DETAIL, { id }),
    enabled: !!id,
  });
  const room = (roomQuery.data as any)?.bbbRoom ?? null;

  // Overview money always describes the current month, whatever month the
  // Recordings tab happens to be browsing.
  const overviewMonth = currentMonth();
  const billingQuery = useQuery({
    queryKey: ['bbbRoomBilling', overviewMonth],
    queryFn: () => api.query(ROOM_BILLING, { month: overviewMonth }),
  });
  const billing = (billingQuery.data as any)?.bbbBillingSummary ?? null;
  const ratePaise = billing?.ratePaisePerHour ?? null;
  const roomBillingRow = (billing?.byRoom ?? []).find((r: any) => r.roomId === id) ?? null;

  const meteredQuery = useQuery({
    queryKey: ['bbbRoomMetered', month],
    queryFn: () => api.query(ROOM_METERED, { month, take: 200 }),
    enabled: !!id && (tab === 'overview' || tab === 'recordings'),
  });
  const roomMetered = ((meteredQuery.data as any)?.bbbMeteredMeetings?.items ?? []).filter(
    (m: any) => m.roomId === id,
  );
  const todayMinutes = roomMetered
    .filter((m: any) => isToday(m.startedAt))
    .reduce((sum: number, m: any) => sum + (m.learnerMinutes ?? 0), 0);

  const sessionsQuery = useQuery({
    queryKey: ['bbbRoomSessions', organizationId],
    queryFn: () => api.query(ROOM_SESSIONS, { organizationId }),
    enabled: !!organizationId && (tab === 'sessions' || tab === 'attendance'),
  });
  const roomSessions: any[] = ((sessionsQuery.data as any)?.bbbScheduledSessions ?? [])
    .filter((s: any) => s.roomId === id)
    .sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  // Phase 5.6 — attendance for this room = the existing per-session summary over
  // the sessions linked to it (there is no room-scoped attendance read). One
  // query function, parallel calls, bounded to the 25 most recent sessions.
  const attendanceQuery = useQuery({
    queryKey: ['bbbRoomAttendance', id, roomSessions.map((s) => s.id).join(',')],
    queryFn: async () => {
      return Promise.all(
        roomSessions.slice(0, 25).map(async (session: any) => {
          const res: any = await api.query(SESSION_ATTENDANCE, { sessionId: session.id });
          return { session, summary: res?.scheduledSessionAttendanceSummary ?? null };
        }),
      );
    },
    enabled: tab === 'attendance' && roomSessions.length > 0,
  });

  const trainersQuery = useQuery({
    queryKey: ['bbbRoomTrainers', organizationId],
    queryFn: () => api.query(ROOM_TRAINERS, { organizationId }),
    enabled: !!organizationId && (tab === 'people' || tab === 'sessions'),
  });
  const trainers: any[] = (trainersQuery.data as any)?.bbbOrganizationMembers?.items ?? [];

  const studentsQuery = useQuery({
    queryKey: ['bbbRoomStudents', id],
    queryFn: () => api.query(ROOM_STUDENTS, { roomId: id }),
    enabled: !!id && tab === 'people',
  });
  const students: any[] = (studentsQuery.data as any)?.bbbEnrollmentsByRoom?.items ?? [];
  const updateMutation = useMutation({
    mutationFn: (input: any) => api.mutate(UPDATE_ROOM, { id, input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbRoom', id] });
      queryClient.invalidateQueries({ queryKey: ['bbbRooms'] });
      setEditName(null); setEditMax(null); setEditRecording(null);
      toast.success('Room updated');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const scheduleMutation = useMutation({
    mutationFn: (input: any) => api.mutate(SCHEDULE_SESSION, { input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbRoomSessions'] });
      queryClient.invalidateQueries({ queryKey: ['bbbDashboardSessions'] });
      setScheduleOpen(false);
      setNewTitle(''); setNewStart(''); setNewEnd(''); setNewTrainerId('');
      toast.success('Class scheduled');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  /**
   * Start (Idle) / Join (Live) — bbbStartRoom, which authorizes before
   * provisioning (INV-027) and returns a moderator join URL. Polls while
   * 'starting'; 'failed'/'unavailable' surface the server's tenant-safe message
   * and never a raw failureReason.
   */
  async function handleStart() {
    if (!room) return;
    setStarting(true);
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        const res: any = await api.mutate(START_ROOM, { roomId: room.id, waitMs: 6000 });
        const r = res?.bbbStartRoom;
        if (!r) throw new Error('Empty response from bbbStartRoom');
        if (r.status === 'active' && r.joinUrl) {
          window.open(r.joinUrl, '_blank', 'noopener');
          queryClient.invalidateQueries({ queryKey: ['bbbRoom', id] });
          queryClient.invalidateQueries({ queryKey: ['bbbRooms'] });
          return;
        }
        if (r.status === 'unavailable' || r.status === 'failed') {
          toast.error(r.status === 'unavailable' ? 'Class unavailable' : 'Class failed to start', {
            description: r.message || undefined,
          });
          queryClient.invalidateQueries({ queryKey: ['bbbRoom', id] });
          return;
        }
        // 'starting' — ask again (the mutation already waited 6s server-side).
      }
      queryClient.invalidateQueries({ queryKey: ['bbbRoom', id] });
      toast.success('Class is starting — Join when it shows Live');
    } catch (err) {
      toast.error('Error', { description: (err as Error).message });
    } finally {
      setStarting(false);
    }
  }

  if (roomQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (roomQuery.isError || !room) {
    return (
      <div className="p-6">
        <div className="mb-4">
          <Link to="/bbb/rooms" className="text-sm text-blue-500 hover:underline">&larr; Back to Rooms</Link>
        </div>
        <Card><div className="p-6 text-center text-red-500">{roomQuery.isError ? 'Failed to load room' : 'Room not found'}</div></Card>
      </div>
    );
  }

  const isLive = room.state === 'Active';
  const isStarting = starting || room.state === 'Provisioning';
  const name = editName ?? room.name;
  const maxP = editMax ?? room.maxParticipants ?? '';
  const rec = editRecording ?? room.recordingEnabled;
  const scheduleValid =
    newTitle.trim().length > 0 && !!newStart && !!newEnd && !!newTrainerId &&
    new Date(newEnd).getTime() > new Date(newStart).getTime();
  return (
    <div className="p-6">
      <div className="mb-4">
        <Link to="/bbb/rooms" className="text-sm text-blue-500 hover:underline">&larr; Back to Rooms</Link>
      </div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{room.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {label} · <Badge variant={STATE_BADGE_VARIANT[room.state] ?? 'default'}>{STATE_LABEL[room.state] ?? room.state}</Badge>
          </p>
        </div>
        <Button onClick={handleStart} disabled={isStarting}>
          {isStarting ? 'Starting…' : isLive ? 'Join class' : 'Start class'}
        </Button>
      </div>
      <div className="mb-6 flex gap-2 border-b">
        {TABS.map((t) => (
          <Button key={t.key} variant={tab === t.key ? 'default' : 'ghost'} size="sm" onClick={() => setTab(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <div className="p-6">
              <div className="text-sm text-muted-foreground">Students</div>
              <div className="text-2xl font-bold">{room.studentCount ?? 0}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {room.maxParticipants ? `Capacity ${room.maxParticipants}` : 'No capacity set'}
              </div>
            </div>
          </Card>
          <Card>
            <div className="p-6">
              <div className="text-sm text-muted-foreground">Rate</div>
              {/* ADR-047 / IA rule: money is integer paise on the wire and is
                  formatted only here, at the edge. */}
              <div className="text-2xl font-bold">
                {ratePaise != null ? `${formatPaiseInr(ratePaise)} / student-hour` : '\u2014'}
              </div>
            </div>
          </Card>
          <Card>
            <div className="p-6">
              <div className="text-sm text-muted-foreground">This month</div>
              <div className="text-2xl font-bold">
                {roomBillingRow ? toStudentHours(roomBillingRow.learnerMinutes) : toStudentHours(0)}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {roomBillingRow ? formatPaiseInr(roomBillingRow.chargePaise) : formatPaiseInr(0)}
              </div>
            </div>
          </Card>
          <Card>
            <div className="p-6">
              <div className="text-sm text-muted-foreground">Today</div>
              <div className="text-2xl font-bold">{toStudentHours(todayMinutes)}</div>
              <div className="mt-1 text-sm text-muted-foreground">student-hours</div>
            </div>
          </Card>
        </div>
      )}
      {tab === 'people' && (
        <div className="grid gap-4">
          <Card>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-medium">Trainers</div>
              <div className="text-sm text-muted-foreground">
                Every academy trainer can teach in any room
              </div>
            </div>
            {trainersQuery.isLoading ? (
              <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : trainers.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">
                No trainers yet. Add trainers from <Link to="/bbb/people" className="text-blue-500 hover:underline">People</Link>.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Email</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trainers.map((t) => (
                      <tr key={t.id} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">{t.customerName || '\u2014'}</td>
                        <td className="px-4 py-3">{t.customerEmail || '\u2014'}</td>
                        <td className="px-4 py-3">{t.role || 'Trainer'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={t.active ? 'success' : 'warning'}>{t.active ? 'Active' : 'Inactive'}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-medium">Students</div>
              <Link to="/bbb/enrollments" className="text-sm text-blue-500 hover:underline">Manage access</Link>
            </div>
            {studentsQuery.isLoading ? (
              <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : students.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">
                No students have access to this room yet. Grant access from{' '}
                <Link to="/bbb/enrollments" className="text-blue-500 hover:underline">Enrollments</Link>.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Email</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Access until</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">{s.customerName || '\u2014'}</td>
                        <td className="px-4 py-3">{s.customerEmail || '\u2014'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={s.active ? 'success' : 'warning'}>{s.active ? 'Active' : 'Inactive'}</Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {s.validUntil ? new Date(s.validUntil).toLocaleDateString() : 'Never'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
      {tab === 'sessions' && (
        <div className="grid gap-4">
          <Card>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-medium">Scheduled classes for this room</div>
              <Button
                size="sm"
                onClick={() => { setScheduleOpen(true); setNewTrainerId(trainers[0]?.id ?? ''); }}
                disabled={!organizationId}
              >
                Schedule a class
              </Button>
            </div>
            {sessionsQuery.isLoading ? (
              <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : sessionsQuery.isError ? (
              <div className="p-6 text-center text-red-500">Failed to load sessions</div>
            ) : roomSessions.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">
                No classes scheduled in this room yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Session</th>
                      <th className="px-4 py-3 font-medium">Starts</th>
                      <th className="px-4 py-3 font-medium">Ends</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Visibility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roomSessions.map((s) => (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">{s.title}</td>
                        <td className="px-4 py-3 text-muted-foreground">{new Date(s.startTime).toLocaleString()}</td>
                        <td className="px-4 py-3 text-muted-foreground">{new Date(s.endTime).toLocaleString()}</td>
                        <td className="px-4 py-3"><Badge variant="outline">{s.status}</Badge></td>
                        <td className="px-4 py-3 text-muted-foreground">{s.visibility ?? '\u2014'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t px-4 py-3 text-xs text-muted-foreground">
              Classes scheduled before a room was linked have no room and appear on the{' '}
              <Link to="/bbb/dashboard" className="text-blue-500 hover:underline">Dashboard</Link>.
            </div>
          </Card>
        </div>
      )}

      {tab === 'attendance' && (
        <Card>
          <div className="border-b px-4 py-3 font-medium">Attendance by class</div>
          {sessionsQuery.isLoading || attendanceQuery.isLoading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : roomSessions.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              No classes scheduled in this room yet — attendance is recorded per scheduled class.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Class</th>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Registered</th>
                    <th className="px-4 py-3 font-medium">Attended</th>
                    <th className="px-4 py-3 font-medium">No-shows</th>
                    <th className="px-4 py-3 font-medium">Attendance</th>
                    <th className="px-4 py-3 font-medium">Avg time</th>
                  </tr>
                </thead>
                <tbody>
                  {(attendanceQuery.data ?? []).map(({ session, summary }: any) => (
                    <tr key={session.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{session.title}</td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(session.startTime).toLocaleString()}</td>
                      <td className="px-4 py-3">{summary?.registered ?? '\u2014'}</td>
                      <td className="px-4 py-3">{summary?.attended ?? '\u2014'}</td>
                      <td className="px-4 py-3">{summary?.noShow ?? '\u2014'}</td>
                      <td className="px-4 py-3">
                        {summary ? `${(summary.attendanceRate * 100).toFixed(0)}%` : '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {summary ? toMinutes(summary.averageDurationSeconds) : '\u2014'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === 'recordings' && (
        <Card>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="font-medium">Recordings</div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium" htmlFor="room-recordings-month">Month</label>
              <input
                id="room-recordings-month"
                type="month"
                className="border rounded px-3 py-2 text-sm"
                value={month}
                onChange={(e) => setMonth(e.target.value || currentMonth())}
              />
            </div>
          </div>
          {meteredQuery.isLoading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : roomMetered.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              No classes recorded in this room in {month}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Class</th>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Students</th>
                    <th className="px-4 py-3 font-medium">Student-hours</th>
                    <th className="px-4 py-3 font-medium">Recording</th>
                  </tr>
                </thead>
                <tbody>
                  {roomMetered.map((m: any) => (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{m.title}</td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(m.startedAt).toLocaleString()}</td>
                      <td className="px-4 py-3">{m.peakLearners}</td>
                      <td className="px-4 py-3">{toStudentHours(m.learnerMinutes)}</td>
                      <td className="px-4 py-3">
                        {m.recordingUrl ? (
                          <a
                            href={m.recordingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-500 hover:underline"
                          >
                            Watch
                          </a>
                        ) : (
                          <span className="text-muted-foreground">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t px-4 py-3 text-xs text-muted-foreground">
            A recording appears once BigBlueButton publishes its playback link — never before, and
            only when recording was enabled for the room.
          </div>
        </Card>
      )}

      {tab === 'settings' && (
        <Card>
          <div className="p-6 grid gap-4 max-w-lg">
            <div className="grid gap-2">
              <Label htmlFor="room-detail-name">Room name</Label>
              <Input id="room-detail-name" value={name} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="room-detail-max">Maximum students</Label>
              <Input
                id="room-detail-max"
                type="number"
                min={1}
                value={maxP}
                onChange={(e) => setEditMax(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="room-detail-rec" checked={!!rec} onCheckedChange={(v) => setEditRecording(!!v)} />
              <Label htmlFor="room-detail-rec">Enable recording</Label>
            </div>
            <div>
              <Button
                onClick={() => {
                  const input: any = {};
                  if (name !== room.name) input.name = name;
                  if ((maxP === '' ? undefined : maxP) !== (room.maxParticipants ?? undefined)) {
                    input.maxParticipants = maxP === '' ? null : maxP;
                  }
                  if (rec !== room.recordingEnabled) input.recordingEnabled = rec;
                  if (Object.keys(input).length === 0) return;
                  updateMutation.mutate(input);
                }}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </Card>
      )}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule a class</DialogTitle>
            <DialogDescription>
              This class will be scheduled into {room.name}. Trainers can be managed from People.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="session-title">Title</Label>
              <Input
                id="session-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Algebra — week 3"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="session-trainer">Trainer</Label>
              <select
                id="session-trainer"
                className="border rounded px-3 py-2 text-sm"
                value={newTrainerId}
                onChange={(e) => setNewTrainerId(e.target.value)}
              >
                <option value="">Select a trainer</option>
                {trainers.map((t) => (
                  <option key={t.id} value={t.customerId ?? t.id}>
                    {t.customerName || t.customerEmail || t.id}
                  </option>
                ))}
              </select>
              {trainers.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  No trainers yet — add one from People first.
                </span>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="session-start">Starts</Label>
              <Input
                id="session-start"
                type="datetime-local"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="session-end">Ends</Label>
              <Input
                id="session-end"
                type="datetime-local"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button
              disabled={!scheduleValid || scheduleMutation.isPending}
              onClick={() =>
                scheduleMutation.mutate({
                  organizationId,
                  title: newTitle.trim(),
                  startTime: toIso(newStart),
                  endTime: toIso(newEnd),
                  trainerId: newTrainerId,
                  roomId: id,
                })
              }
            >
              {scheduleMutation.isPending ? 'Scheduling…' : 'Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
