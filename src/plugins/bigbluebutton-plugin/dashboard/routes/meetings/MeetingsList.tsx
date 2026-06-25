import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';

const STATE_BADGE: Record<string, 'success' | 'warning' | 'default' | 'destructive'> = {
  Pending: 'warning',
  Provisioning: 'warning',
  Active: 'success',
  Completed: 'default',
  Archived: 'default',
  Failed: 'destructive',
};

const GET_MEETINGS = `
  query GetBbbMeetings($options: BbbMeetingListOptions) {
    bbbMeetings(options: $options) {
      items {
        id createdAt title state bbbMeetingId recordingEnabled
        provisionedAt completedAt failureReason retryCount
        organization { id name slug }
      }
      totalItems
    }
  }
`;

const GET_ORGS = `
  query GetBbbOrgsForMeetings {
    bbbOrganizations { items { id name slug } }
  }
`;

const CREATE_MEETING = `
  mutation CreateBbbMeeting($input: CreateBbbMeetingInput!) {
    createBbbMeeting(input: $input) { id title state }
  }
`;

const UPDATE_MEETING = `
  mutation UpdateBbbMeeting($id: ID!, $input: UpdateBbbMeetingInput!) {
    updateBbbMeeting(id: $id, input: $input) { id title recordingEnabled }
  }
`;

const DELETE_MEETING = `
  mutation DeleteBbbMeeting($id: ID!) { deleteBbbMeeting(id: $id) }
`;

const END_MEETING = `
  mutation EndBbbMeeting($id: ID!) { endBbbMeeting(id: $id) { id state } }
`;

const RETRY_MEETING = `
  mutation RetryBbbMeeting($failedMeetingId: ID!) {
    retryBbbMeeting(failedMeetingId: $failedMeetingId) { id title state }
  }
`;

interface BbbMeeting {
  id: string; createdAt: string; title: string; state: string;
  bbbMeetingId?: string; recordingEnabled: boolean;
  provisionedAt?: string; completedAt?: string;
  failureReason?: string; retryCount: number;
  organization: BbbOrganization;
}

interface BbbOrganization { id: string; name: string; slug: string }

interface MeetingsResponse { bbbMeetings: { items: BbbMeeting[]; totalItems: number } }

interface OrgsResponse { bbbOrganizations: { items: BbbOrganization[] } }

function formatOrgLabel(org: BbbOrganization) {
  const displaySlug = org.slug === '__default_channel__' ? 'default' : org.slug;
  return `${org.name} (${displaySlug})`;
}

export function MeetingsList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<BbbMeeting | null>(null);
  const [newOrgId, setNewOrgId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newRecording, setNewRecording] = useState(false);
  const [editTitle, setEditTitle] = useState('');

  const { data, isLoading, isError } = useQuery<MeetingsResponse>({
    queryKey: ['bbbMeetings', page],
    queryFn: () => api.query(GET_MEETINGS, {
      options: { skip: (page - 1) * pageSize, take: pageSize },
    }),
    placeholderData: (prev) => prev,
  });

  const orgsQuery = useQuery<OrgsResponse>({
    queryKey: ['bbbOrganizations'],
    queryFn: () => api.query(GET_ORGS),
  });

  const meetings = data?.bbbMeetings?.items ?? [];
  const organizations = orgsQuery.data?.bbbOrganizations?.items ?? [];
  const totalItems = data?.bbbMeetings?.totalItems ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const createMutation = useMutation({
    mutationFn: (input: any) => api.mutate(CREATE_MEETING, { input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbMeetings'] });
      setCreateOpen(false);
      toast.success('Meeting created', { description: 'Provisioning in background...' });
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: any }) => api.mutate(UPDATE_MEETING, { id, input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbMeetings'] });
      setEditOpen(false);
      setEditingMeeting(null);
      toast.success('Meeting updated');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.mutate(DELETE_MEETING, { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbMeetings'] });
      toast.success('Meeting deleted');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const endMutation = useMutation({
    mutationFn: (id: string) => api.mutate(END_MEETING, { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbMeetings'] });
      toast.success('Meeting ended');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const retryMutation = useMutation({
    mutationFn: (failedMeetingId: string) => api.mutate(RETRY_MEETING, { failedMeetingId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbMeetings'] });
      toast.success('Retry meeting created');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  function openEdit(m: BbbMeeting) {
    setEditingMeeting(m);
    setEditTitle(m.title);
    setEditOpen(true);
  }

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  function handleDeleteClick(m: BbbMeeting) {
    setDeleteTargetId(m.id);
  }

  function handleDeleteConfirm() {
    if (deleteTargetId) {
      deleteMutation.mutate(deleteTargetId);
      setDeleteTargetId(null);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">BBB Meetings</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button>Create Meeting</Button>} />
          <DialogContent>
            <DialogHeader><DialogTitle>New Meeting</DialogTitle><DialogDescription>Create and provision a new meeting.</DialogDescription></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="meeting-org">Organization</Label>
                <Select value={newOrgId} onValueChange={setNewOrgId}>
                  <SelectTrigger id="meeting-org">
                    <SelectValue placeholder={orgsQuery.isLoading ? 'Loading organizations...' : 'Select organization'} />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.length === 0 ? (
                      <SelectItem value="__no-organizations__" disabled>No organizations available</SelectItem>
                    ) : (
                      organizations.map((org) => (
                        <SelectItem key={org.id} value={org.id}>{formatOrgLabel(org)}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {orgsQuery.isError && <p className="text-xs text-red-500">Failed to load organizations</p>}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="meeting-title">Meeting Title</Label>
                <Input id="meeting-title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Weekly Training Session" />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="meeting-recording" checked={newRecording} onCheckedChange={(v) => setNewRecording(!!v)} />
                <Label htmlFor="meeting-recording">Enable Recording</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={() => createMutation.mutate({ organizationId: newOrgId, title: newTitle, recordingEnabled: newRecording })} disabled={!newTitle || !newOrgId || createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create & Provision'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : isError ? (
          <div className="p-6 text-center text-red-500">Failed to load meetings</div>
        ) : meetings.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">No meetings found</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>BBB Meeting ID</TableHead>
                  <TableHead>Provisioned</TableHead>
                  <TableHead>Recording</TableHead>
                  <TableHead>Retry</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meetings.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="font-medium">{m.title}</div>
                      <div className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{m.organization.name}</div>
                      <div className="text-xs text-muted-foreground">{m.organization.slug}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATE_BADGE[m.state] ?? 'default'}>{m.state}</Badge>
                      {m.state === 'Failed' && m.failureReason && (
                        <div className="text-xs text-red-500 mt-1">{m.failureReason}</div>
                      )}
                    </TableCell>
                    <TableCell><code className="text-xs">{m.bbbMeetingId || '—'}</code></TableCell>
                    <TableCell className="text-sm">{m.provisionedAt ? new Date(m.provisionedAt).toLocaleString() : 'Pending'}</TableCell>
                    <TableCell>
                      <Badge variant={m.recordingEnabled ? 'success' : 'warning'}>{m.recordingEnabled ? 'Enabled' : 'Disabled'}</Badge>
                    </TableCell>
                    <TableCell>{m.retryCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2 flex-wrap">
                        {(m.state === 'Active' || m.state === 'Completed') && (
                          <Button variant="outline" size="sm" onClick={() => openEdit(m)}>Edit</Button>
                        )}
                        {m.state === 'Active' && (
                          <Button variant="destructive" size="sm" onClick={() => endMutation.mutate(m.id)}>End</Button>
                        )}
                        {m.state === 'Failed' && (
                          <Button variant="outline" size="sm" onClick={() => retryMutation.mutate(m.id)}>Retry</Button>
                        )}
                        <Button variant="destructive" size="sm" onClick={() => handleDeleteClick(m)}>Delete</Button>
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

      <Dialog open={!!deleteTargetId} onOpenChange={(o) => !o && setDeleteTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Meeting</DialogTitle>
            <DialogDescription>Are you sure you want to delete this meeting? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Meeting</DialogTitle><DialogDescription>Update meeting settings.</DialogDescription></DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input id="edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              if (!editingMeeting) return;
              if (editTitle !== editingMeeting.title) {
                updateMutation.mutate({ id: editingMeeting.id, input: { title: editTitle } });
              } else {
                setEditOpen(false);
              }
            }} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}