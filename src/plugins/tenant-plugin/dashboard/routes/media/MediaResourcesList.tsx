import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';

const GET_MEDIA = `
  query GetMediaResources($options: MediaResourceListOptions) {
    mediaResources(options: $options) {
      items { id ownerType ownerId type url title displayOrder isFeatured isActive createdAt }
      totalItems
    }
  }
`;

const CREATE_MEDIA = `
  mutation CreateMediaResource($input: CreateMediaResourceInput!) {
    createMediaResource(input: $input) { id type url title isActive }
  }
`;

const UPDATE_MEDIA = `
  mutation UpdateMediaResource($input: UpdateMediaResourceInput!) {
    updateMediaResource(input: $input) { id type url title displayOrder isFeatured isActive }
  }
`;

const DELETE_MEDIA = `
  mutation DeleteMediaResource($id: ID!) {
    deleteMediaResource(id: $id)
  }
`;

const MEDIA_TYPES = ['image', 'video', 'document', 'audio', 'other'];
const OWNER_TYPES = ['instructor', 'course', 'tenant', 'organization'];

interface MediaItem {
  id: string; ownerType: string; ownerId: string;
  type: string; url: string; title: string;
  displayOrder: number; isFeatured: boolean; isActive: boolean; createdAt: string;
}

export function MediaResourcesList() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [createOpen, setCreateOpen] = useState(false);

  // Create form
  const [newOwnerType, setNewOwnerType] = useState('instructor');
  const [newOwnerId, setNewOwnerId] = useState('');
  const [newType, setNewType] = useState('image');
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');

  // Edit state
  const [editing, setEditing] = useState<MediaItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editDisplayOrder, setEditDisplayOrder] = useState(0);
  const [editIsFeatured, setEditIsFeatured] = useState(false);
  const [editIsActive, setEditIsActive] = useState(true);

  const { data, isLoading } = useQuery<{ mediaResources: { items: MediaItem[]; totalItems: number } }>({
    queryKey: ['mediaResources', page],
    queryFn: () => api.query(GET_MEDIA, { options: { skip: (page - 1) * pageSize, take: pageSize } }),
    placeholderData: (prev) => prev,
  });

  const items = data?.mediaResources?.items ?? [];
  const totalItems = data?.mediaResources?.totalItems ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const createMutation = useMutation({
    mutationFn: (input: any) => api.mutate(CREATE_MEDIA, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mediaResources'] });
      setCreateOpen(false);
      toast.success('Media resource created');
      setNewUrl(''); setNewTitle('');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const updateMutation = useMutation({
    mutationFn: (input: any) => api.mutate(UPDATE_MEDIA, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mediaResources'] });
      setEditing(null);
      toast.success('Media resource updated');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.mutate(DELETE_MEDIA, { id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mediaResources'] });
      toast.success('Media resource deleted');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  function openEdit(item: MediaItem) {
    setEditing(item);
    setEditTitle(item.title);
    setEditUrl(item.url);
    setEditDisplayOrder(item.displayOrder);
    setEditIsFeatured(item.isFeatured);
    setEditIsActive(item.isActive);
  }

  function handleDelete(item: MediaItem) {
    if (window.confirm(`Delete media "${item.title}"?`)) {
      deleteMutation.mutate(item.id);
    }
  }

  function handleCreate() {
    createMutation.mutate({
      ownerType: newOwnerType,
      ownerId: newOwnerId,
      type: newType,
      url: newUrl,
      title: newTitle,
    });
  }

  function handleUpdate() {
    if (!editing) return;
    updateMutation.mutate({
      id: editing.id,
      title: editTitle,
      url: editUrl,
      displayOrder: editDisplayOrder,
      isFeatured: editIsFeatured,
      isActive: editIsActive,
    });
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Media Resources</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button>Add Media</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Media Resource</DialogTitle>
              <DialogDescription>Add a new media resource.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Owner Type</Label>
                <Select value={newOwnerType} onValueChange={setNewOwnerType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OWNER_TYPES.map(ot => <SelectItem key={ot} value={ot}>{ot}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Owner ID</Label>
                <Input value={newOwnerId} onChange={(e) => setNewOwnerId(e.target.value)} placeholder="Owner entity ID" />
              </div>
              <div className="grid gap-2">
                <Label>Media Type</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MEDIA_TYPES.map(mt => <SelectItem key={mt} value={mt}>{mt}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>URL</Label>
                <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="grid gap-2">
                <Label>Title</Label>
                <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Resource title" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!newUrl || !newTitle || createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">No media resources found</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Featured</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell><Badge variant="outline">{item.type}</Badge></TableCell>
                    <TableCell className="text-sm">{item.ownerType} #{item.ownerId?.substring(0, 8)}</TableCell>
                    <TableCell className="max-w-40">
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline truncate block">{item.url}</a>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.isFeatured ? 'success' : 'warning'}>{item.isFeatured ? 'Yes' : 'No'}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.isActive ? 'success' : 'warning'}>{item.isActive ? 'Active' : 'Inactive'}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(item)}>Edit</Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(item)}>Delete</Button>
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

      {/* Edit Dialog */}
      {editing && (
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Media Resource</DialogTitle>
              <DialogDescription>Update media resource details.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Title</Label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>URL</Label>
                <Input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Display Order</Label>
                <Input type="number" value={editDisplayOrder} onChange={(e) => setEditDisplayOrder(Number(e.target.value))} />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={editIsFeatured} onChange={(e) => setEditIsFeatured(e.target.checked)} />
                  <span className="text-sm">Featured</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={editIsActive} onChange={(e) => setEditIsActive(e.target.checked)} />
                  <span className="text-sm">Active</span>
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}