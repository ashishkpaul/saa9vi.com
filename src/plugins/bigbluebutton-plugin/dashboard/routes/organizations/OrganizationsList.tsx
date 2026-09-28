import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { PageHeader, EmptyState } from '../../shared/PageHeader';
import { ConfirmDialog } from '../../shared/ConfirmDialog';

const GET_ORGANIZATIONS = `
  query GetBbbOrganizations($options: BbbOrganizationListOptions) {
    bbbOrganizations(options: $options) {
      items {
        id
        channelId
        slug
        name
        concurrentMeetingLimit
        maxParticipantsPerMeeting
        recordingEnabled
        suspended
      }
      totalItems
    }
  }
`;

// Channel tokens are credentials: they are never fetched into (or rendered
// by) the dashboard. The seller name is the channel's human label; the code
// remains the technical identifier shown small/muted.
const GET_CHANNELS = `
  query GetChannelsForOrg {
    channels {
      items {
        id
        code
        seller {
          name
        }
      }
    }
  }
`;

// Note: TenantProfile is resolved per-channel via tenantProfile(channelId: String!)
// There's no bulk list query, so we keep this as a manual input for now.
// In a future iteration, this could be replaced with a channel-based auto-lookup.

const CREATE_ORGANIZATION = `
  mutation CreateBbbOrganization($input: CreateBbbOrganizationInput!) {
    createBbbOrganization(input: $input) {
      id
      slug
      name
    }
  }
`;

const UPDATE_ORGANIZATION = `
  mutation UpdateBbbOrganization($id: ID!, $input: UpdateBbbOrganizationInput!) {
    updateBbbOrganization(id: $id, input: $input) {
      id
      slug
      name
      concurrentMeetingLimit
      maxParticipantsPerMeeting
      recordingEnabled
      suspended
    }
  }
`;

const DELETE_ORGANIZATION = `
  mutation DeleteBbbOrganization($id: ID!) {
    deleteBbbOrganization(id: $id)
  }
`;

interface BbbOrganization {
  id: string;
  channelId: string;
  slug: string;
  name: string;
  concurrentMeetingLimit: number;
  maxParticipantsPerMeeting: number;
  recordingEnabled: boolean;
  suspended: boolean;
}

interface Channel {
  id: string;
  code: string;
  seller?: { name: string } | null;
}

interface TenantProfile {
  id: string;
  businessName: string;
  channelId: string;
}

interface OrgsResponse {
  bbbOrganizations: {
    items: BbbOrganization[];
    totalItems: number;
  };
}

/**
 * Channel column: human label first, technical code second (small/muted),
 * with the raw channel ID kept in the hover title for support/debug use.
 * Channel tokens are credentials and are never rendered anywhere.
 */
function renderChannelCell(channelId: string, channelById: Map<string, Channel>) {
  const ch = channelById.get(channelId);
  return (
    <div title={`Channel ID: ${channelId}`}>
      {ch?.seller?.name && <div className="text-sm">{ch.seller.name}</div>}
      <code className="text-xs text-muted-foreground">{ch ? ch.code : channelId}</code>
    </div>
  );
}

export function OrganizationsList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<BbbOrganization | null>(null);

  // Create form
  const [newChannelId, setNewChannelId] = useState('');
  const [newTenantProfileId, setNewTenantProfileId] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newName, setNewName] = useState('');
  const [newConcurrentLimit, setNewConcurrentLimit] = useState(5);
  const [newMaxParticipants, setNewMaxParticipants] = useState(30);

  // Edit form
  const [editName, setEditName] = useState('');
  const [editConcurrentLimit, setEditConcurrentLimit] = useState(5);
  const [editMaxParticipants, setEditMaxParticipants] = useState(30);
  // Edit form: recording / suspended (previously missing — issue #4)
  const [editRecording, setEditRecording] = useState(false);
  const [editSuspended, setEditSuspended] = useState(false);

  const { data, isLoading, isError } = useQuery<OrgsResponse>({
    queryKey: ['bbbOrganizations', page],
    queryFn: () =>
      api.query(GET_ORGANIZATIONS, {
        options: { skip: (page - 1) * pageSize, take: pageSize },
      }),
    placeholderData: (prev) => prev,
  });

  const channelsQuery = useQuery<{ channels: { items: Channel[] } }>({
    queryKey: ['channelsForOrg'],
    queryFn: () => api.query(GET_CHANNELS),
  });
  const channels = channelsQuery.data?.channels?.items ?? [];
  const channelById = new Map(channels.map(ch => [String(ch.id), ch]));


  const organizations = data?.bbbOrganizations?.items ?? [];
  const totalItems = data?.bbbOrganizations?.totalItems ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const createMutation = useMutation({
    mutationFn: (input: any) => api.mutate(CREATE_ORGANIZATION, { input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbOrganizations'] });
      setCreateOpen(false);
      toast.success('Organization created');
    },
    onError: (err: Error) =>
      toast.error('Error', { description: err.message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: any }) =>
      api.mutate(UPDATE_ORGANIZATION, { id, input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbOrganizations'] });
      setEditOpen(false);
      setEditingOrg(null);
      toast.success('Organization updated');
    },
    onError: (err: Error) =>
      toast.error('Error', { description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.mutate(DELETE_ORGANIZATION, { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbOrganizations'] });
      toast.success('Organization deleted');
      setDeleteTargetId(null);
    },
    onError: (err: Error) =>
      toast.error('Error', { description: err.message }),
  });

  function openEdit(org: BbbOrganization) {
    setEditingOrg(org);
    setEditName(org.name);
    setEditConcurrentLimit(org.concurrentMeetingLimit);
    setEditMaxParticipants(org.maxParticipantsPerMeeting);
    setEditRecording(org.recordingEnabled);
    setEditSuspended(org.suspended);
    setEditOpen(true);
  }

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  function handleDeleteClick(org: BbbOrganization) {
    setDeleteTargetId(org.id);
  }

  function handleDeleteConfirm() {
    if (deleteTargetId) deleteMutation.mutate(deleteTargetId);
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Organizations"
        description="Tenants using BigBlueButton. Each organization maps to a Vendure channel with dedicated meeting and participant limits."
        action={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger render={<Button>Add Organization</Button>} />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Organization</DialogTitle>
                <DialogDescription>Create a new BigBlueButton organization.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="channelId">Channel</Label>
                  <Select value={newChannelId} onValueChange={(val) => {
                    setNewChannelId(val);
                    // Auto-populate slug from channel code
                    const ch = channels.find(c => c.id === val);
                    if (ch && !newSlug) setNewSlug(ch.code.toLowerCase().replace(/\s+/g, '-'));
                  }}>
                    <SelectTrigger><SelectValue placeholder={channelsQuery.isLoading ? 'Loading channels...' : 'Select channel'} /></SelectTrigger>
                    <SelectContent>
                      {channels.map(ch => <SelectItem key={ch.id} value={ch.id}>{ch.seller?.name ? `${ch.seller.name} · ${ch.code}` : ch.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {newChannelId && channelsQuery.error && <p className="text-xs text-red-500">Channel lookup unavailable</p>}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tenantProfileId">Tenant Profile ID</Label>
                  <Input id="tenantProfileId" value={newTenantProfileId} onChange={(e) => setNewTenantProfileId(e.target.value)} placeholder="Enter TenantProfile ID (optional)" />
                  <p className="text-xs text-muted-foreground">
                    Optional — set up via Academy → Tenant Profile first, then enter the ID here. 
                    Auto-lookup will be added when a bulk query becomes available.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="slug">Slug</Label>
                  <Input id="slug" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="acme-academy" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="orgName">Display Name</Label>
                  <Input id="orgName" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Acme Academy" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="concurrentLimit">Concurrent Meeting Limit</Label>
                    <Input id="concurrentLimit" type="number" value={newConcurrentLimit} onChange={(e) => setNewConcurrentLimit(Number(e.target.value))} min={1} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="maxParticipants">Max Participants per Meeting</Label>
                    <Input id="maxParticipants" type="number" value={newMaxParticipants} onChange={(e) => setNewMaxParticipants(Number(e.target.value))} min={1} />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={() => createMutation.mutate({ channelId: newChannelId, tenantProfileId: newTenantProfileId || undefined, slug: newSlug, name: newName, concurrentMeetingLimit: newConcurrentLimit, maxParticipantsPerMeeting: newMaxParticipants })} disabled={!newChannelId || !newSlug || !newName || createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : isError ? (
          <div className="p-6 text-center text-red-500">Failed to load organizations</div>
        ) : organizations.length === 0 ? (
          <EmptyState
            title="No organizations yet"
            hint="Create the first organization to map a channel to BigBlueButton."
            action={<Button onClick={() => setCreateOpen(true)}>Add Organization</Button>}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Limits</TableHead>
                  <TableHead>Recording</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell>
                      <div className="font-medium">{org.name}</div>
                      <div className="text-xs text-muted-foreground">{org.slug}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {org.concurrentMeetingLimit} concurrent
                        <br />
                        {org.maxParticipantsPerMeeting} participants
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={org.recordingEnabled ? 'success' : 'warning'}>
                        {org.recordingEnabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={org.suspended ? 'destructive' : 'success'}>
                        {org.suspended ? 'Suspended' : 'Active'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {renderChannelCell(String(org.channelId), channelById)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(org)}>Edit</Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDeleteClick(org)}>Delete</Button>
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

      <ConfirmDialog
        open={!!deleteTargetId}
        title="Delete Organization"
        description="The organization is deleted permanently, together with its room and session associations. Learners enrolled through those rooms lose access. This cannot be undone."
        pending={deleteMutation.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTargetId(null)}
      />

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
            <DialogDescription>Update organization settings.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-org-name">Name</Label>
              <Input id="edit-org-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-concurrent">Concurrent Limit</Label>
                <Input id="edit-concurrent" type="number" value={editConcurrentLimit} onChange={(e) => setEditConcurrentLimit(Number(e.target.value))} min={1} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-max-participants">Max Participants</Label>
                <Input id="edit-max-participants" type="number" value={editMaxParticipants} onChange={(e) => setEditMaxParticipants(Number(e.target.value))} min={1} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="edit-recording">Recording</Label>
                <p className="text-xs text-muted-foreground">Allow meetings in this organization to be recorded.</p>
              </div>
              <Switch id="edit-recording" checked={editRecording} onCheckedChange={setEditRecording} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="edit-suspended">Suspended</Label>
                <p className="text-xs text-muted-foreground">Suspended organizations cannot start new meetings.</p>
              </div>
              <Switch id="edit-suspended" checked={editSuspended} onCheckedChange={setEditSuspended} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              if (!editingOrg) return;
              const input: any = {};
              if (editName !== editingOrg.name) input.name = editName;
              if (editConcurrentLimit !== editingOrg.concurrentMeetingLimit) input.concurrentMeetingLimit = editConcurrentLimit;
              if (editMaxParticipants !== editingOrg.maxParticipantsPerMeeting) input.maxParticipantsPerMeeting = editMaxParticipants;
              if (editRecording !== editingOrg.recordingEnabled) input.recordingEnabled = editRecording;
              if (editSuspended !== editingOrg.suspended) input.suspended = editSuspended;
              if (Object.keys(input).length === 0) { setEditOpen(false); return; }
              updateMutation.mutate({ id: editingOrg.id, input });
            }} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
