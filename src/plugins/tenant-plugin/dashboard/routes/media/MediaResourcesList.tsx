import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useMemo, useState } from 'react';
import { AcademyPageHeader, EmptyState, LoadingRows, PaginationFooter } from '../../shared/academy-dashboard';

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
  const [ownerTypeFilter, setOwnerTypeFilter] = useState('all');
  const [search, setSearch] = useState('');

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
    queryKey: ['mediaResources', page, ownerTypeFilter],
    queryFn: () => api.query(GET_MEDIA, { options: { skip: (page - 1) * pageSize, take: pageSize, ...(ownerTypeFilter !== 'all' ? { ownerType: ownerTypeFilter } : {}) } }),
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

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  function handleDeleteClick(item: MediaItem) {
    setDeleteTargetId(item.id);
  }

  function handleDeleteConfirm() {
    if (deleteTargetId) {
      deleteMutation.mutate(deleteTargetId);
      setDeleteTargetId(null);
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

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.url.toLowerCase().includes(q) ||
      item.ownerType.toLowerCase().includes(q) ||
      item.type.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="p-6">
      <AcademyPageHeader
        title="Media Library"
        description="Manage reusable media attached to instructors, tenants, courses, sessions, and future content workflows. Filter by owner type to keep the library domain-oriented."
      >
        <Input className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search current page..." />
        <Select value={ownerTypeFilter} onValueChange={(value) => { setOwnerTypeFilter(value); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            {OWNER_TYPES.map(ot => <SelectItem key={ot} value={ot}>{ot}</SelectItem>)}
          </SelectContent>
        </Select>
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
      </AcademyPageHeader>

      <Card>
        {isLoading ? (
          <LoadingRows count={4} />
        ) : items.length === 0 ? (
          <EmptyState title="No media resources found" description="Add media to enrich instructor, tenant, course, and session experiences." />
        ) : visibleItems.length === 0 ? (
          <EmptyState title="No matches on this page" description="Try a different search term or owner type filter." />
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
                {visibleItems.map((item) => (
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
                          <Button variant="destructive" size="sm" onClick={() => handleDeleteClick(item)}>Delete</Button>
                        </div>
                      </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationFooter page={page} totalPages={totalPages} totalItems={totalItems} onPrevious={() => setPage(p => Math.max(1, p - 1))} onNext={() => setPage(p => p + 1)} />
          </>
        )}
      </Card>

      <Dialog open={!!deleteTargetId} onOpenChange={(o) => !o && setDeleteTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Media</DialogTitle>
            <DialogDescription>Are you sure you want to delete this media? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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