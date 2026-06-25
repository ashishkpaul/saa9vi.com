import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useMemo, useState } from 'react';
import { AcademyPageHeader, EmptyState, LoadingRows, PaginationFooter } from '../../shared/academy-dashboard';

const GET_INSTRUCTORS = `
  query GetInstructorProfiles($options: InstructorProfileListOptions) {
    instructorProfiles(options: $options) {
      items { id slug fullName bio credentials expertiseAreas displayOrder isActive isPublic createdAt }
      totalItems
    }
  }
`;

const CREATE_INSTRUCTOR = `
  mutation CreateInstructorProfile($input: CreateInstructorProfileInput!) {
    createInstructorProfile(input: $input) { id slug fullName isActive isPublic }
  }
`;

const UPDATE_INSTRUCTOR = `
  mutation UpdateInstructorProfile($input: UpdateInstructorProfileInput!) {
    updateInstructorProfile(input: $input) { id slug fullName bio credentials expertiseAreas displayOrder isActive isPublic }
  }
`;

const DELETE_INSTRUCTOR = `
  mutation DeleteInstructorProfile($id: ID!) {
    deleteInstructorProfile(id: $id)
  }
`;

interface Instructor {
  id: string; slug: string; fullName: string; bio?: string;
  credentials?: string; expertiseAreas: string[];
  displayOrder: number; isActive: boolean; isPublic: boolean; createdAt: string;
}

export function InstructorsList() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Create form
  const [newCustomerId, setNewCustomerId] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newBio, setNewBio] = useState('');
  const [newCredentials, setNewCredentials] = useState('');
  const [newExpertise, setNewExpertise] = useState('');
  const [newIsPublic, setNewIsPublic] = useState(true);

  // Delete confirmation
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // Edit state
  const [editing, setEditing] = useState<Instructor | null>(null);
  const [editSlug, setEditSlug] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editCredentials, setEditCredentials] = useState('');
  const [editExpertise, setEditExpertise] = useState('');
  const [editDisplayOrder, setEditDisplayOrder] = useState(0);
  const [editIsActive, setEditIsActive] = useState(true);
  const [editIsPublic, setEditIsPublic] = useState(true);

  const { data, isLoading } = useQuery<{ instructorProfiles: { items: Instructor[]; totalItems: number } }>({
    queryKey: ['instructorProfiles', page],
    queryFn: () => api.query(GET_INSTRUCTORS, { options: { skip: (page - 1) * pageSize, take: pageSize } }),
    placeholderData: (prev) => prev,
  });

  const instructors = data?.instructorProfiles?.items ?? [];
  const totalItems = data?.instructorProfiles?.totalItems ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const createMutation = useMutation({
    mutationFn: (input: any) => api.mutate(CREATE_INSTRUCTOR, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instructorProfiles'] });
      setCreateOpen(false);
      toast.success('Instructor created');
      setNewCustomerId(''); setNewSlug(''); setNewFullName(''); setNewBio(''); setNewCredentials(''); setNewExpertise(''); setNewIsPublic(true);
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const updateMutation = useMutation({
    mutationFn: (input: any) => api.mutate(UPDATE_INSTRUCTOR, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instructorProfiles'] });
      setEditing(null);
      toast.success('Instructor updated');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.mutate(DELETE_INSTRUCTOR, { id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instructorProfiles'] });
      toast.success('Instructor deleted');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  function openEdit(instructor: Instructor) {
    setEditing(instructor);
    setEditSlug(instructor.slug);
    setEditFullName(instructor.fullName);
    setEditBio(instructor.bio ?? '');
    setEditCredentials(instructor.credentials ?? '');
    setEditExpertise(instructor.expertiseAreas?.join(', ') ?? '');
    setEditDisplayOrder(instructor.displayOrder);
    setEditIsActive(instructor.isActive);
    setEditIsPublic(instructor.isPublic);
  }

  function handleDeleteClick(instructor: Instructor) {
    setDeleteTargetId(instructor.id);
  }

  function handleDeleteConfirm() {
    if (deleteTargetId) {
      deleteMutation.mutate(deleteTargetId);
      setDeleteTargetId(null);
    }
  }

  function handleCreate() {
    createMutation.mutate({
      customerId: newCustomerId,
      slug: newSlug,
      fullName: newFullName,
      bio: newBio || undefined,
      credentials: newCredentials || undefined,
      expertiseAreas: newExpertise ? newExpertise.split(',').map(s => s.trim()) : [],
      isPublic: newIsPublic,
      isActive: true,
    });
  }

  const visibleInstructors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return instructors;
    return instructors.filter(inst =>
      inst.fullName.toLowerCase().includes(q) ||
      inst.slug.toLowerCase().includes(q) ||
      inst.expertiseAreas?.some(area => area.toLowerCase().includes(q)),
    );
  }, [instructors, search]);

  function handleUpdate() {
    if (!editing) return;
    updateMutation.mutate({
      id: editing.id,
      slug: editSlug,
      fullName: editFullName,
      bio: editBio || undefined,
      credentials: editCredentials || undefined,
      expertiseAreas: editExpertise ? editExpertise.split(',').map(s => s.trim()) : [],
      displayOrder: editDisplayOrder,
      isActive: editIsActive,
      isPublic: editIsPublic,
    });
  }

  return (
    <div className="p-6">
      <AcademyPageHeader
        title="Instructors"
        description="Manage public teaching profiles for the active academy channel. These profiles become the trust layer for future courses, sessions, marketplace discovery, and media ownership."
      >
        <Input className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search current page..." />
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button>Add Instructor</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Instructor</DialogTitle>
              <DialogDescription>Create a new instructor profile.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Customer ID</Label>
                <Input value={newCustomerId} onChange={(e) => setNewCustomerId(e.target.value)} placeholder="Vendure customer ID" />
                <p className="text-xs text-muted-foreground">Instructor profiles are backed by a Vendure Customer. Paste the customer ID for now; a customer picker can be added next.</p>
              </div>
              <div className="grid gap-2">
                <Label>Slug</Label>
                <Input value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="john-doe" />
              </div>
              <div className="grid gap-2">
                <Label>Full Name</Label>
                <Input value={newFullName} onChange={(e) => setNewFullName(e.target.value)} placeholder="John Doe" />
              </div>
              <div className="grid gap-2">
                <Label>Bio</Label>
                <Textarea value={newBio} onChange={(e) => setNewBio(e.target.value)} placeholder="Instructor bio" />
              </div>
              <div className="grid gap-2">
                <Label>Credentials</Label>
                <Input value={newCredentials} onChange={(e) => setNewCredentials(e.target.value)} placeholder="PhD, CFA" />
              </div>
              <div className="grid gap-2">
                <Label>Expertise Areas (comma-separated)</Label>
                <Input value={newExpertise} onChange={(e) => setNewExpertise(e.target.value)} placeholder="Finance, Economics" />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label>Public profile</Label>
                <Switch checked={newIsPublic} onCheckedChange={setNewIsPublic} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!newCustomerId || !newSlug || !newFullName || createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AcademyPageHeader>

      <Card>
        {isLoading ? (
          <LoadingRows count={4} />
        ) : instructors.length === 0 ? (
          <EmptyState title="No instructors found" description="Create the first instructor profile to start building your academy trust layer." />
        ) : visibleInstructors.length === 0 ? (
          <EmptyState title="No matches on this page" description="Try a different search term or move to another page." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Expertise</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleInstructors.map((inst) => (
                  <TableRow key={inst.id}>
                    <TableCell className="font-medium">{inst.fullName}</TableCell>
                    <TableCell className="text-sm">{inst.slug}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {inst.expertiseAreas?.map((area, i) => (
                          <Badge key={i} variant="outline">{area}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={inst.isActive ? 'success' : 'warning'}>{inst.isActive ? 'Active' : 'Inactive'}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={inst.isPublic ? 'success' : 'warning'}>{inst.isPublic ? 'Public' : 'Private'}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(inst)}>Edit</Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDeleteClick(inst)}>Delete</Button>
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
            <DialogTitle>Delete Instructor</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this instructor? This action cannot be undone.
            </DialogDescription>
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
              <DialogTitle>Edit Instructor</DialogTitle>
              <DialogDescription>Update instructor profile.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Slug</Label>
                <Input value={editSlug} onChange={(e) => setEditSlug(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Full Name</Label>
                <Input value={editFullName} onChange={(e) => setEditFullName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Bio</Label>
                <Textarea value={editBio} onChange={(e) => setEditBio(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Credentials</Label>
                <Input value={editCredentials} onChange={(e) => setEditCredentials(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Expertise Areas (comma-separated)</Label>
                <Input value={editExpertise} onChange={(e) => setEditExpertise(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={editIsActive} onChange={(e) => setEditIsActive(e.target.checked)} />
                  <span className="text-sm">Active</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={editIsPublic} onChange={(e) => setEditIsPublic(e.target.checked)} />
                  <span className="text-sm">Public</span>
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