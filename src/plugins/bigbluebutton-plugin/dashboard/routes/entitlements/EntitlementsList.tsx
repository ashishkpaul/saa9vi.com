import { useMutation, useQuery } from '@tanstack/react-query';
import { api, Badge, Button, Card, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { PageHeader, EmptyState } from '../../shared/PageHeader';
import { EntitlementStatusBadge } from '../../shared/StatusBadge';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { formatDate } from '../../shared/dates';

const GET_ENTITLEMENTS = `
  query GetBbbEntitlements($options: BbbEntitlementListOptions) {
    bbbEntitlements(options: $options) {
      items { id customerId type resourceId source validFrom validUntil createdAt }
      totalItems
    }
  }
`;

const DELETE_ENTITLEMENT = `
  mutation DeleteBbbEntitlement($id: ID!) { deleteBbbEntitlement(id: $id) }
`;

export function EntitlementsList() {
  const [page, setPage] = useState(1);
  const [customerIdFilter, setCustomerIdFilter] = useState('');
  const pageSize = 25;

  const query = useQuery<any>({
    queryKey: ['bbbEntitlements', page, customerIdFilter],
    queryFn: () => api.query(GET_ENTITLEMENTS, {
      options: {
        skip: (page - 1) * pageSize,
        take: pageSize,
        filter: customerIdFilter ? { customerId: { contains: customerIdFilter } } : undefined,
      }
    }),
  });
  const items = query.data?.bbbEntitlements?.items ?? [];
  const totalItems = query.data?.bbbEntitlements?.totalItems ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.mutate(DELETE_ENTITLEMENT, { id }),
    onSuccess: () => { query.refetch(); toast.success('Entitlement deleted'); setDeleteTargetId(null); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  return (
    <div className="p-6">
      <PageHeader
        title="Entitlements"
        description="Learner access grants. Rows with an end date before the start date are data errors — fix the source record."
      />

      <Card className="mb-6 p-4">
        <div className="flex items-end gap-4">
          <div>
            <Label>Filter by Customer ID</Label>
            <input
              className="border rounded px-3 py-2 text-sm"
              placeholder="Paste customer ID..."
              value={customerIdFilter}
              onChange={(e) => { setCustomerIdFilter(e.target.value); setPage(1); }}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => { setCustomerIdFilter(''); setPage(1); }}>Clear</Button>
        </div>
      </Card>

      {query.isLoading ? (
        <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 w-full bg-muted animate-pulse rounded" />)}</div>
      ) : items.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground">No entitlements found.</div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Resource ID</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Valid From</TableHead>
                <TableHead>Valid Until</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">{e.customerId}</TableCell>
                  <TableCell><Badge>{e.type}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{e.resourceId}</TableCell>
                  <TableCell><Badge variant="outline">{e.source}</Badge></TableCell>
                  <TableCell>
                    <EntitlementStatusBadge entitlement={e} />
                  </TableCell>
                  <TableCell className="text-sm">{e.validFrom ? formatDate(e.validFrom) : '—'}</TableCell>
                  <TableCell className="text-sm">{e.validUntil ? formatDate(e.validUntil) : 'Never'}</TableCell>
                  <TableCell className="text-sm">{formatDate(e.createdAt)}</TableCell>
                  <TableCell>
                    <Button variant="destructive" size="sm" onClick={() => setDeleteTargetId(e.id)}>Delete</Button>
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
        </Card>
      )}

      <ConfirmDialog
        open={deleteTargetId !== null}
        title="Delete entitlement"
        description="The learner immediately loses access to this resource. Order and grant history is kept — the ledger is immutable. This cannot be undone."
        pending={deleteMutation.isPending}
        onConfirm={() => deleteTargetId && deleteMutation.mutate(deleteTargetId)}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
}
