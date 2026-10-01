import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Skeleton } from '@vendure/dashboard';
import { graphql } from '@/gql';
import { useCurrentOrganization } from '../../shared/useCurrentOrganization';
import { toast } from 'sonner';
import { useState } from 'react';
import { Link } from '@vendure/dashboard';

// ─── S5 (Phase 6 lean) + S6 (UX completion) — tenant Rooms cards ─────────────
// Room cards: name, N students (batched studentCount, S4), Ready/Live badge,
// [Start]/[Join] (bbbStartRoom, polls while starting) + [Manage] (room
// detail). No plumbing in the tenant document (A11): no currentMeetingId,
// retryCount, slug, or lastProvisionRequestedAt. Typed graphql() (A24).
//
// Drift note (S6): Phase 6 §3.2 asks for `students · trainers` on the card.
// Item 4's `trainerCount` is deferred by the Phase-5 scope decision (only
// `studentCount` was implemented), so the card renders students alone — adding
// trainers needs the deferred backend field, not a UI change.

const GET_ROOM_CARDS = graphql(`
  query BbbTenantRoomCards($organizationId: ID!, $options: BbbRoomListOptions) {
    bbbRooms(organizationId: $organizationId, options: $options) {
      items {
        id
        name
        state
        recordingEnabled
        maxParticipants
        studentCount
      }
      totalItems
    }
  }
`);

const START_ROOM = graphql(`
  mutation BbbTenantStartRoom($roomId: ID!, $waitMs: Int) {
    bbbStartRoom(roomId: $roomId, waitMs: $waitMs) {
      status
      joinUrl
      roomState
      message
    }
  }
`);

const CREATE_ROOM = graphql(`
  mutation BbbTenantCreateRoom($input: CreateBbbRoomInput!) {
    createBbbRoom(input: $input) {
      id
      name
      state
    }
  }
`);

const DELETE_ROOM = graphql(`
  mutation BbbTenantDeleteRoom($id: ID!) {
    deleteBbbRoom(id: $id)
  }
`);

const RESET_ROOM = graphql(`
  mutation BbbTenantResetRoom($id: ID!) {
    resetBbbRoom(id: $id) {
      id
      state
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

interface BbbRoomCard {
  id: string; name: string; state: string;
  recordingEnabled: boolean; maxParticipants?: number | null;
  studentCount?: number | null;
}

interface RoomsResponse { bbbRooms: { items: BbbRoomCard[]; totalItems: number } }


export function RoomsList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  // Channel = Tenant (INV-001): the organization is resolved server-side from
  // the active channel — a client-side picker could disagree with ctx.channelId.
  const { organizationId, label, isLoading: orgLoading } = useCurrentOrganization();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMaxStudents, setNewMaxStudents] = useState<number | ''>('');
  const [newRecording, setNewRecording] = useState(false);
  // roomId -> 'starting' while a bbbStartRoom poll loop is in flight.
  const [startingIds, setStartingIds] = useState<Record<string, boolean>>({});

  const roomsQuery = useQuery<RoomsResponse>({
    queryKey: ['bbbRooms', organizationId, page],
    queryFn: () => api.query(GET_ROOM_CARDS, {
      organizationId,
      options: { skip: (page - 1) * pageSize, take: pageSize },
    }),
    enabled: !!organizationId,
    placeholderData: (prev) => prev,
  });

  const rooms = roomsQuery.data?.bbbRooms?.items ?? [];
  const totalItems = roomsQuery.data?.bbbRooms?.totalItems ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const createMutation = useMutation({
    mutationFn: (input: any) => api.mutate(CREATE_ROOM, { input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbRooms', organizationId] });
      setCreateOpen(false);
      setNewName(''); setNewMaxStudents(''); setNewRecording(false);
      toast.success('Room created');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.mutate(DELETE_ROOM, { id }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bbbRooms', organizationId] }); setDeleteTargetId(null); toast.success('Room deleted'); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) => api.mutate(RESET_ROOM, { id }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bbbRooms', organizationId] }); toast.success('Room reset — ready to start again'); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  function handleDeleteClick(room: BbbRoomCard) {
    setDeleteTargetId(room.id);
  }

  function handleDeleteConfirm() {
    if (deleteTargetId) deleteMutation.mutate(deleteTargetId);
  }

  /**
   * Start (Idle) or Join (Live): calls bbbStartRoom, opens the moderator
   * joinUrl when live, polls while starting (idempotent — repeats are
   * absorbed by the lock/debounce), surfaces the tenant-safe message on
   * unavailable/failed (never a raw failureReason).
   */
  async function handleStart(room: BbbRoomCard) {
    setStartingIds((s) => ({ ...s, [room.id]: true }));
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        const res: any = await api.mutate(START_ROOM, { roomId: room.id, waitMs: 6000 });
        const r = res?.bbbStartRoom;
        if (!r) throw new Error('Empty response from bbbStartRoom');
        if (r.status === 'active' && r.joinUrl) {
          window.open(r.joinUrl, '_blank', 'noopener');
          queryClient.invalidateQueries({ queryKey: ['bbbRooms', organizationId] });
          return;
        }
        if (r.status === 'unavailable' || r.status === 'failed') {
          toast.error(r.status === 'unavailable' ? 'Class unavailable' : 'Class failed to start', {
            description: r.message || undefined,
          });
          queryClient.invalidateQueries({ queryKey: ['bbbRooms', organizationId] });
          return;
        }
        // 'starting' — loop again (the mutation already waited 6s server-side).
      }
      queryClient.invalidateQueries({ queryKey: ['bbbRooms', organizationId] });
      toast.success('Class is starting — Join when it shows Live');
    } catch (err) {
      toast.error('Error', { description: (err as Error).message });
    } finally {
      setStartingIds((s) => {
        const next = { ...s };
        delete next[room.id];
        return next;
      });
    }
  }

  if (orgLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="p-6">
        <Card><div className="p-6 text-center text-muted-foreground">No organization is bound to this channel</div></Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rooms</h1>
          <p className="mt-1 text-sm text-muted-foreground">{label}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create room</Button>
      </div>

      {roomsQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : roomsQuery.isError ? (
        <Card><div className="p-6 text-center text-red-500">Failed to load rooms</div></Card>
      ) : rooms.length === 0 ? (
        <Card><div className="p-6 text-center text-muted-foreground">No rooms yet. Create your first classroom to get started.</div></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => {
            const isLive = room.state === 'Active';
            const isStarting = room.state === 'Provisioning' || startingIds[room.id];
            const isFailed = room.state === 'Failed';
            return (
              <Card key={room.id} className="p-5 flex flex-col gap-3">
                <div>
                  <div className="text-lg font-semibold">{room.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {room.studentCount ?? 0} students
                  </div>
                </div>
                <div>
                  <Badge variant={STATE_BADGE_VARIANT[room.state] ?? 'default'}>
                    <span className="mr-1">{isLive ? '●' : '○'}</span>
                    {STATE_LABEL[room.state] ?? room.state}
                  </Badge>
                </div>
                <div className="mt-auto flex gap-2">
                  {isFailed ? (
                    <Button size="sm" variant="outline" onClick={() => resetMutation.mutate(room.id)} disabled={resetMutation.isPending}>
                      Reset
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => handleStart(room)} disabled={isStarting}>
                      {isStarting ? 'Starting…' : isLive ? 'Join class' : 'Start class'}
                    </Button>
                  )}
                  <Link to={`/bbb/rooms/${room.id}`}>
                    <Button size="sm" variant="outline">Manage</Button>
                  </Link>
                  <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => handleDeleteClick(room)}>Delete</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">{totalItems} total</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <span className="text-sm">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={!!deleteTargetId} onOpenChange={(o) => !o && setDeleteTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Room</DialogTitle>
            <DialogDescription>Are you sure you want to delete this room? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create room</DialogTitle><DialogDescription>A new classroom in {label}.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="room-name">Room name</Label>
              <Input id="room-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Python Masterclass" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="room-max">Maximum students</Label>
              <Input id="room-max" type="number" min={1} value={newMaxStudents} onChange={(e) => setNewMaxStudents(e.target.value === '' ? '' : Number(e.target.value))} placeholder="50" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="room-recording" checked={newRecording} onCheckedChange={(v) => setNewRecording(!!v)} />
              <Label htmlFor="room-recording">Enable recording</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId, name: newName, maxParticipants: newMaxStudents === '' ? undefined : newMaxStudents, recordingEnabled: newRecording })} disabled={!newName.trim() || createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create room'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
