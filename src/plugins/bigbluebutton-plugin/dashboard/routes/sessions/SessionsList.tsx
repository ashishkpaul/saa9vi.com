import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import { Link } from '@vendure/dashboard';
import { OrgSwitcher, useBbbOrgs } from '../../shared/OrgSwitcher';
import { useSelectedOrgId } from '../../shared/orgStore';
import { PageHeader, EmptyState } from '../../shared/PageHeader';
import { formatDate, formatRelative, formatDateTime } from '../../shared/dates';
import { SessionStatusBadge } from '../../shared/StatusBadge';
import { ConfirmDialog } from '../../shared/ConfirmDialog';

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

export function SessionsList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [selectedOrgId] = useSelectedOrgId();
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);

  // Shared org list (single fetch, cached 5 min) keeps the switcher warm.
  useBbbOrgs();

  // Reset paging whenever the shared org selection changes.
  useEffect(() => {
    setPage(1);
  }, [selectedOrgId]);

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
      <PageHeader
        title="Sessions"
        description="Scheduled class slots. Sessions become joinable when the trainer starts the live meeting."
      />
      <div className="mb-6">
        <OrgSwitcher />
      </div>

      <Card>
        {!selectedOrgId ? (
          <EmptyState
            title="Select an organization"
            hint="Session data is scoped per organization. Choose one above to continue."
          />
        ) : isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : isError ? (
          <div className="p-6 text-center text-red-500">Failed to load sessions</div>
        ) : sessions.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            hint="Schedule the first session for this organization to start hosting classes."
          />
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
                    </TableCell>
                    <TableCell>
                      <SessionStatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <div title={formatDateTime(s.startTime)}>{formatRelative(s.startTime)}</div>
                      <div className="text-xs text-muted-foreground">ends {formatDate(s.endTime)}</div>
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

      <ConfirmDialog
        open={!!cancelTargetId}
        title="Cancel session"
        description="Enrolled learners lose access to this slot. The session record is kept for history. This cannot be undone."
        confirmLabel="Cancel session"
        cancelLabel="Keep session"
        pending={cancelMutation.isPending}
        onConfirm={() => cancelTargetId && cancelMutation.mutate(cancelTargetId)}
        onCancel={() => setCancelTargetId(null)}
      />
    </div>
  );
}
