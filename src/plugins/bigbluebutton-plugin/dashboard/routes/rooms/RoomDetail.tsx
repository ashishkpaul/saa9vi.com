import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Button, Card, Checkbox, Skeleton } from '@vendure/dashboard';
import type { DashboardRouteDefinition } from '@vendure/dashboard';
import type { AnyRoute } from '@vendure/dashboard';
import { graphql } from '@/gql';
import { toast } from 'sonner';
import { useState } from 'react';
import { Link } from '@vendure/dashboard';
import { useCurrentOrganization } from '../../shared/useCurrentOrganization';
import { formatPaiseInr } from '../../../shared/format';

// ─── S5 (Phase 6 lean) — Room detail (Overview | Meetings | Settings) ────────
// Lean v1: three tabs only. Overview (name, students, rate, Start), Meetings
// (bbbMeetings(roomId) history), Settings (name, max students, recording).
// Deferred: People/Sessions/Attendance/Recordings tabs, per-room trainers
// (D5). Typed graphql() (A24). No plumbing (A11).

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

const ROOM_MEETINGS = graphql(`
  query BbbTenantRoomMeetings($roomId: ID!, $options: BbbMeetingListOptions) {
    bbbMeetings(roomId: $roomId, options: $options) {
      items {
        id
        title
        state
        provisionedAt
        completedAt
      }
      totalItems
    }
  }
`);

const BILLING_RATE = graphql(`
  query BbbTenantRoomBillingRate {
    bbbBillingSummary {
      ratePaisePerHour
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

export const roomDetail: DashboardRouteDefinition = {
  path: '/bbb/rooms/$id',
  loader: () => ({ breadcrumb: 'Room detail' }),
  component: (route) => <RoomDetailPage route={route as AnyRoute} />,
};

type Tab = 'overview' | 'meetings' | 'settings';

function RoomDetailPage({ route }: { route: AnyRoute }) {
  const params = route.useParams() as { id: string };
  const id = params.id;
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [starting, setStarting] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);
  const [editMax, setEditMax] = useState<number | '' | null>(null);
  const [editRecording, setEditRecording] = useState<boolean | null>(null);

  const roomQuery = useQuery({
    queryKey: ['bbbRoom', id],
    queryFn: () => api.query(ROOM_DETAIL, { id }),
    enabled: !!id,
  });
  const room = (roomQuery.data as any)?.bbbRoom ?? null;

  const rateQuery = useQuery({
    queryKey: ['bbbBillingRate'],
    queryFn: () => api.query(BILLING_RATE, {}),
  });
  const ratePaise = (rateQuery.data as any)?.bbbBillingSummary?.ratePaisePerHour ?? null;

  const meetingsQuery = useQuery({
    queryKey: ['bbbRoomMeetings', id],
    queryFn: () => api.query(ROOM_MEETINGS, { roomId: id, options: { take: 25 } }),
    enabled: !!id && tab === 'meetings',
  });
  const meetings = (meetingsQuery.data as any)?.bbbMeetings?.items ?? [];

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
          return;
        }
        if (r.status === 'unavailable' || r.status === 'failed') {
          toast.error(r.status === 'unavailable' ? 'Class unavailable' : 'Class failed to start', {
            description: r.message || undefined,
          });
          queryClient.invalidateQueries({ queryKey: ['bbbRoom', id] });
          return;
        }
      }
      toast.success('Class is starting - Join when it shows Live');
    } catch (err) {
      toast.error('Error', { description: (err as Error).message });
    } finally {
      setStarting(false);
    }
  }

  const { label } = useCurrentOrganization();

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
  const name = editName ?? room.name;
  const maxP = editMax ?? room.maxParticipants ?? '';
  const rec = editRecording ?? room.recordingEnabled;

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link to="/bbb/rooms" className="text-sm text-blue-500 hover:underline">&larr; Back to Rooms</Link>
      </div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{room.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{label}</p>
        </div>
        <Button onClick={handleStart} disabled={starting || room.state === 'Provisioning'}>
          {starting || room.state === 'Provisioning' ? 'Starting...' : isLive ? 'Join class' : 'Start class'}
        </Button>
      </div>
      <div className="mb-6 flex gap-2 border-b">
        {(['overview', 'meetings', 'settings'] as Tab[]).map((t) => (
          <Button key={t} variant={tab === t ? 'default' : 'ghost'} size="sm" onClick={() => setTab(t)}>
            {t === 'overview' ? 'Overview' : t === 'meetings' ? 'Meetings' : 'Settings'}
          </Button>
        ))}
      </div>
      {tab === 'overview' && (
        <Card>
          <div className="p-6 grid gap-4 md:grid-cols-3">
            <div>
              <div className="text-sm text-muted-foreground">Students</div>
              <div className="text-2xl font-bold">{room.studentCount ?? 0}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Rate</div>
              {/* ADR-047 / IA rule: money is integer paise on the wire and is
                  formatted only here, at the edge. */}
              <div className="text-2xl font-bold">{ratePaise != null ? `${formatPaiseInr(ratePaise)} / student-hour` : '\u2014'}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Status</div>
              <div className="text-2xl font-bold">{isLive ? 'Live' : room.state === 'Provisioning' ? 'Starting' : room.state === 'Failed' ? 'Unavailable' : 'Ready'}</div>
            </div>
          </div>
        </Card>
      )}
      {tab === 'meetings' && (
        <Card>
          {meetingsQuery.isLoading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : meetings.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">No classes yet for this room.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Class</th>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {meetings.map((m: any) => (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{m.title}</td>
                      <td className="px-4 py-3 text-muted-foreground">{m.provisionedAt ? new Date(m.provisionedAt).toLocaleString() : '\u2014'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{m.completedAt ? new Date(m.completedAt).toLocaleString() : '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === 'settings' && (
        <Card>
          <div className="p-6 grid gap-4 max-w-lg">
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="room-detail-name">Room name</label>
              <input id="room-detail-name" className="border rounded px-3 py-2 text-sm" value={name} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="room-detail-max">Maximum students</label>
              <input id="room-detail-max" type="number" min={1} className="border rounded px-3 py-2 text-sm" value={maxP} onChange={(e) => setEditMax(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="room-detail-rec" checked={!!rec} onCheckedChange={(v) => setEditRecording(!!v)} />
              <label className="text-sm font-medium" htmlFor="room-detail-rec">Enable recording</label>
            </div>
            <div>
              <Button
                onClick={() => {
                  const input: any = {};
                  if (name !== room.name) input.name = name;
                  if ((maxP === '' ? undefined : maxP) !== (room.maxParticipants ?? undefined)) input.maxParticipants = maxP === '' ? null : maxP;
                  if (rec !== room.recordingEnabled) input.recordingEnabled = rec;
                  if (Object.keys(input).length === 0) return;
                  updateMutation.mutate(input);
                }}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
