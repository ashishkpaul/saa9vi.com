import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';

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

const GET_ORGS = `
  query GetBbbOrgsForRoomPicker {
    bbbOrganizations {
      items { id name slug }
      totalItems
    }
  }
`;

const GET_ROOMS = `
  query GetBbbRooms($organizationId: ID!, $options: BbbRoomListOptions) {
    bbbRooms(organizationId: $organizationId, options: $options) {
      items {
        id createdAt updatedAt name description slug state
        currentMeetingId retryCount recordingEnabled maxParticipants
        lastProvisionRequestedAt
      }
      totalItems
    }
  }
`;

const CREATE_ROOM = `
  mutation CreateBbbRoom($input: CreateBbbRoomInput!) {
    createBbbRoom(input: $input) { id name state }
  }
`;

const DELETE_ROOM = `
  mutation DeleteBbbRoom($id: ID!) { deleteBbbRoom(id: $id) }
`;

const RESET_ROOM = `
  mutation ResetBbbRoom($id: ID!) { resetBbbRoom(id: $id) { id state } }
`;

interface BbbRoom {
  id: string; name: string; description?: string; slug?: string; state: string;
  currentMeetingId?: string; retryCount: number; recordingEnabled: boolean;
  maxParticipants?: number;
}

interface RoomsResponse { bbbRooms: { items: BbbRoom[]; totalItems: number } }

export function RoomsList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newRecording, setNewRecording] = useState(false);

  const orgsQuery = useQuery<any>({
    queryKey: ['bbbOrgsForRooms'],
    queryFn: () => api.query(GET_ORGS),
    enabled: true,
  });
  const organizations = orgsQuery.data?.bbbOrganizations?.items ?? [];

  const roomsQuery = useQuery<RoomsResponse>({
    queryKey: ['bbbRooms', selectedOrgId, page],
    queryFn: () => api.query(GET_ROOMS, {
      organizationId: selectedOrgId,
      options: { skip: (page - 1) * pageSize, take: pageSize },
    }),
    enabled: !!selectedOrgId,
    placeholderData: (prev) => prev,
  });

  const rooms = roomsQuery.data?.bbbRooms?.items ?? [];
  const totalItems = roomsQuery.data?.bbbRooms?.totalItems ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const createMutation = useMutation({
    mutationFn: (input: any) => api.mutate(CREATE_ROOM, { input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbRooms', selectedOrgId] });
      setCreateOpen(false);
      setNewName(''); setNewSlug(''); setNewDescription(''); setNewRecording(false);
      toast.success('Room created');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.mutate(DELETE_ROOM, { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbRooms', selectedOrgId] });
      toast.success('Room deleted');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) => api.mutate(RESET_ROOM, { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbRooms', selectedOrgId] });
      toast.success('Room reset to Idle');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4">BBB Rooms</h1>
        <div className="max-w-xs">
          <Label htmlFor="org-picker">Organization</Label>
          <Select value={selectedOrgId} onValueChange={(v) => { setSelectedOrgId(v); setPage(1); }}>
            <SelectTrigger id="org-picker">
              <SelectValue placeholder="-- Select organization --" />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((org: any) => (
                <SelectItem key={org.id} value={org.id}>{org.name} ({org.slug})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedOrgId && (
        <>
          <div className="mb-4">
            <Button onClick={() => setCreateOpen(true)}>Create Room</Button>
          </div>

          <Card>
            {roomsQuery.isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : roomsQuery.isError ? (
              <div className="p-6 text-center text-red-500">Failed to load rooms</div>
            ) : rooms.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">No rooms yet. Create one above.</div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Recording</TableHead>
                      <TableHead>Current Session</TableHead>
                      <TableHead>Retries</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rooms.map((room) => (
                      <TableRow key={room.id}>
                        <TableCell>
                          <div className="font-medium">{room.name}</div>
                          <div className="text-xs text-muted-foreground">{room.description || '—'} | Slug: {room.slug || '—'}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATE_BADGE_VARIANT[room.state] ?? 'default'}>
                            {STATE_LABEL[room.state] ?? room.state}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={room.recordingEnabled ? 'success' : 'warning'}>
                            {room.recordingEnabled ? 'On' : 'Off'}
                          </Badge>
                        </TableCell>
                        <TableCell><code className="text-xs">{room.currentMeetingId || '—'}</code></TableCell>
                        <TableCell>{room.retryCount}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {room.state === 'Failed' && (
                              <Button variant="outline" size="sm" onClick={() => resetMutation.mutate(room.id)}>Reset</Button>
                            )}
                            <Button variant="destructive" size="sm" onClick={() => {
                              if (window.confirm(`Delete room "${room.name}"?`)) deleteMutation.mutate(room.id);
                            }}>Delete</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <div className="text-sm text-muted-foreground">{totalItems} total</div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
                    <span className="text-sm">Page {page} of {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Room</DialogTitle><DialogDescription>Create a new room in this organization.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="room-name">Room Name</Label>
                <Input id="room-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Training Room A" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="room-slug">Slug (optional)</Label>
                <Input id="room-slug" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="training-room-a" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="room-desc">Description</Label>
              <Input id="room-desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Weekly team training sessions" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="room-recording" checked={newRecording} onCheckedChange={(v) => setNewRecording(!!v)} />
              <Label htmlFor="room-recording">Enable Recording</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: selectedOrgId, name: newName, slug: newSlug || undefined, description: newDescription || undefined, recordingEnabled: newRecording })} disabled={!newName || createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Room'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}