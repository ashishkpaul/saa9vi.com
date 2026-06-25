import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';

const GET_SERVERS = `
  query GetBbbServers($options: BbbServerListOptions) {
    bbbServers(options: $options) {
      items {
        id
        name
        apiUrl
        enabled
        healthy
        currentLoad
        maxLoad
        lastHealthCheckAt
      }
      totalItems
    }
  }
`;

const CREATE_SERVER = `
  mutation CreateBbbServer($input: CreateBbbServerInput!) {
    createBbbServer(input: $input) {
      id
      name
      apiUrl
      enabled
      healthy
    }
  }
`;

const UPDATE_SERVER = `
  mutation UpdateBbbServer($id: ID!, $input: UpdateBbbServerInput!) {
    updateBbbServer(id: $id, input: $input) {
      id
      name
      apiUrl
      enabled
      healthy
      currentLoad
      maxLoad
    }
  }
`;

const DELETE_SERVER = `
  mutation DeleteBbbServer($id: ID!) {
    deleteBbbServer(id: $id)
  }
`;

interface BbbServer {
  id: string;
  name: string;
  apiUrl: string;
  enabled: boolean;
  healthy: boolean;
  currentLoad: number;
  maxLoad: number;
  lastHealthCheckAt: string | null;
}

interface ServersResponse {
  bbbServers: {
    items: BbbServer[];
    totalItems: number;
  };
}

export function ServersList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<BbbServer | null>(null);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newApiUrl, setNewApiUrl] = useState('');
  const [newApiSecret, setNewApiSecret] = useState('');
  const [newMaxLoad, setNewMaxLoad] = useState(50);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editApiUrl, setEditApiUrl] = useState('');
  const [editMaxLoad, setEditMaxLoad] = useState(50);

  const { data, isLoading, isError } = useQuery<ServersResponse>({
    queryKey: ['bbbServers', page],
    queryFn: () =>
      api.query(GET_SERVERS, {
        options: {
          skip: (page - 1) * pageSize,
          take: pageSize,
        },
      }),
    placeholderData: (prev) => prev,
  });

  const servers = data?.bbbServers?.items ?? [];
  const totalItems = data?.bbbServers?.totalItems ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const createMutation = useMutation({
    mutationFn: (input: { name: string; apiUrl: string; apiSecret: string; maxLoad: number }) =>
      api.mutate(CREATE_SERVER, { input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbServers'] });
      setCreateDialogOpen(false);
      resetCreateForm();
      toast.success('Server added', { description: 'Server created successfully' });
    },
    onError: (err: Error) => {
        toast.error('Error', { description: err.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: any }) =>
      api.mutate(UPDATE_SERVER, { id, input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbServers'] });
      setEditDialogOpen(false);
      setEditingServer(null);
      toast.success('Server updated');
    },
    onError: (err: Error) => {
        toast.error('Error', { description: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.mutate(DELETE_SERVER, { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbServers'] });
      toast.success('Server deleted');
    },
    onError: (err: Error) => {
        toast.error('Error', { description: err.message });
    },
  });

  function resetCreateForm() {
    setNewName('');
    setNewApiUrl('');
    setNewApiSecret('');
    setNewMaxLoad(50);
  }

  function openEditDialog(server: BbbServer) {
    setEditingServer(server);
    setEditName(server.name);
    setEditApiUrl(server.apiUrl);
    setEditMaxLoad(server.maxLoad);
    setEditDialogOpen(true);
  }

  function handleToggleEnabled(server: BbbServer) {
    updateMutation.mutate({
      id: server.id,
      input: { enabled: !server.enabled },
    });
  }

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  function handleDeleteClick(server: BbbServer) {
    setDeleteTargetId(server.id);
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
        <h1 className="text-2xl font-bold">BBB Servers</h1>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger render={<Button>Add Server</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add BBB Server</DialogTitle>
              <DialogDescription>
                Add a new BigBlueButton server to the pool.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Primary BBB Server"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="apiUrl">API URL</Label>
                <Input
                  id="apiUrl"
                  value={newApiUrl}
                  onChange={(e) => setNewApiUrl(e.target.value)}
                  placeholder="https://bbb.example.com/bigbluebutton"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="apiSecret">API Secret</Label>
                <Input
                  id="apiSecret"
                  type="password"
                  value={newApiSecret}
                  onChange={(e) => setNewApiSecret(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="maxLoad">Max Load</Label>
                <Input
                  id="maxLoad"
                  type="number"
                  value={newMaxLoad}
                  onChange={(e) => setNewMaxLoad(Number(e.target.value))}
                  min={1}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  createMutation.mutate({
                    name: newName,
                    apiUrl: newApiUrl,
                    apiSecret: newApiSecret,
                    maxLoad: newMaxLoad,
                  })
                }
                disabled={!newName || !newApiUrl || !newApiSecret || createMutation.isPending}
              >
                {createMutation.isPending ? 'Adding...' : 'Add Server'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-6 text-center text-red-500">Failed to load servers</div>
        ) : servers.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">No BBB servers configured</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>API URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Load</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.map((server) => (
                  <TableRow key={server.id}>
                    <TableCell className="font-medium">{server.name}</TableCell>
                    <TableCell>
                      <code className="text-xs">{server.apiUrl}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={server.healthy ? 'success' : 'destructive'}>
                        {server.healthy ? 'Healthy' : 'Unhealthy'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {server.currentLoad} / {server.maxLoad}
                    </TableCell>
                    <TableCell>
                      <Badge variant={server.enabled ? 'success' : 'warning'}>
                        {server.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(server)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleEnabled(server)}
                        >
                          {server.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteClick(server)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <div className="text-sm text-muted-foreground">
                {totalItems} total server{totalItems !== 1 ? 's' : ''}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <Dialog open={!!deleteTargetId} onOpenChange={(o) => !o && setDeleteTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Server</DialogTitle>
            <DialogDescription>Are you sure you want to delete this server? This action cannot be undone.</DialogDescription>
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
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Server</DialogTitle>
            <DialogDescription>Update server configuration.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-apiUrl">API URL</Label>
              <Input
                id="edit-apiUrl"
                value={editApiUrl}
                onChange={(e) => setEditApiUrl(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-maxLoad">Max Load</Label>
              <Input
                id="edit-maxLoad"
                type="number"
                value={editMaxLoad}
                onChange={(e) => setEditMaxLoad(Number(e.target.value))}
                min={1}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editingServer) return;
                const input: any = {};
                if (editName !== editingServer.name) input.name = editName;
                if (editApiUrl !== editingServer.apiUrl) input.apiUrl = editApiUrl;
                if (editMaxLoad !== editingServer.maxLoad) input.maxLoad = editMaxLoad;
                if (Object.keys(input).length === 0) {
                  setEditDialogOpen(false);
                  return;
                }
                updateMutation.mutate({ id: editingServer.id, input });
              }}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}