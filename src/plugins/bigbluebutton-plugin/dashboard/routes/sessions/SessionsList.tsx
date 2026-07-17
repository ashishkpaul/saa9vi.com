import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { Link } from '@vendure/dashboard';

const STATUS_BADGE: Record<string, 'success' | 'warning' | 'default' | 'destructive'> = {
  SCHEDULED: 'default',
  LIVE: 'success',
  FINISHED: 'default',
  CANCELLED: 'destructive',
};

const GET_SESSIONS = `
  query GetBbbScheduledSessions($organizationId: ID!) {
    bbbScheduledSessions(organizationId: $organizationId) {
      id
      title
      status
      startTime
      endTime
      trainerId
      isTrial
      visibility
      maxAttendees
      productVariantId
      activeMeetingId
      organization { id name slug }
    }
  }
`;

const GET_ORGS = `
  query GetBbbOrgsForSessions {
    bbbOrganizations { items { id name slug } }
  }
`;

const CANCEL_SESSION = `
  mutation CancelBbbScheduledSession($id: ID!) {
    cancelBbbScheduledSession(id: $id) { id status }
  }
`;

interface BbbScheduledSession {
  id: string;
  title: string;
  status: string;
  startTime: string;
  endTime: string;
  trainerId: string;
  isTrial: boolean;
  visibility: string;
  maxAttendees: number | null;
  productVariantId: string | null;
  activeMeetingId: string | null;
  organization: { id: string; name: string; slug: string };
}

interface SessionsResponse {
  bbbScheduledSessions: BbbScheduledSession[];
}

interface OrgsResponse {
  bbbOrganizations: { items: { id: string; name: string; slug: string }[] };
}

function formatOrgLabel(org: { name: string; slug: string }) {
  const displaySlug = org.slug === '__default_channel__' ? 'default' : org.slug;
  return `${org.name} (${displaySlug})`;
}

export function SessionsList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);

  const orgsQuery = useQuery<OrgsResponse>({
    queryKey: ['bbbOrganizations'],
    queryFn: () => api.query(GET_ORGS),
  });

  const organizations = orgsQuery.data?.bbbOrganizations?.items ?? [];

  // Auto-select first org when orgs load
  if (!selectedOrgId && organizations.length > 0) {
    setSelectedOrgId(organizations[0].id);
  }

  const { data, isLoading, isError } = useQuery<SessionsResponse>({
    queryKey: ['bbbScheduledSessions', selectedOrgId],
    queryFn: () => api.query(GET_SESSIONS, { organizationId: selectedOrgId }),
    enabled: !!selectedOrgId,
    placeholderData: (prev) => prev,
  });

  const sessions = data?.bbbScheduledSessions ?? [];
  const totalItems = sessions.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const paginatedSessions = sessions.slice((page - 1) * pageSize, page * pageSize);

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.mutate(CANCEL_SESSION, { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbScheduledSessions'] });
      setCancelTargetId(null);
      toast.success('Session cancelled');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scheduled Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and manage educational sessions across organizations.
          </p>
        </div>
        <div className="w-72">
          <Select value={selectedOrgId} onValueChange={(v) => { setSelectedOrgId(v); setPage(1); }}>
            <SelectTrigger>
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
          {orgsQuery.isError && <p className="mt-1 text-xs text-red-500">Failed to load organizations</p>}
        </div>
      </div>

      <Card>
        {!selectedOrgId ? (
          <div className="p-6 text-center text-muted-foreground">Select an organization to view sessions</div>
        ) : isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : isError ? (
          <div className="p-6 text-center text-red-500">Failed to load sessions</div>
        ) : sessions.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">No sessions found for this organization</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Trainer</TableHead>
                  <TableHead>Trial</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedSessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link to={`/bbb/sessions/${s.id}`} className="font-medium hover:underline">
                        {s.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">{new Date(s.startTime).toLocaleDateString()}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[s.status] ?? 'default'}>{s.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{new Date(s.startTime).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">→ {new Date(s.endTime).toLocaleString()}</div>
                    </TableCell>
                    <TableCell><code className="text-xs">{s.trainerId}</code></TableCell>
                    <TableCell>
                      <Badge variant={s.isTrial ? 'warning' : 'default'}>{s.isTrial ? 'Yes' : 'No'}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{s.visibility}</TableCell>
                    <TableCell className="text-sm">{s.maxAttendees ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {s.status === 'SCHEDULED' && (
                          <Button variant="destructive" size="sm" onClick={() => setCancelTargetId(s.id)}>Cancel</Button>
                        )}
                        <Button variant="outline" size="sm" render={<Link to={`/bbb/sessions/${s.id}`} />}>View</Button>
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

      <Dialog open={!!cancelTargetId} onOpenChange={(o) => !o && setCancelTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Session</DialogTitle>
            <DialogDescription>Are you sure you want to cancel this scheduled session? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTargetId(null)}>Keep</Button>
            <Button variant="destructive" onClick={() => cancelTargetId && cancelMutation.mutate(cancelTargetId)} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
