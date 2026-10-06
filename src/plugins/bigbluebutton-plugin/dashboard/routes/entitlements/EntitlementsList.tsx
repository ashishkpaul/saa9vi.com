import { useMutation, useQuery } from '@tanstack/react-query';
import { api, Badge, Button, Card, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { graphql } from '@/gql';

const GET_ENTITLEMENTS = graphql(`
  query GetBbbEntitlements($options: BbbEntitlementListOptions) {
    bbbEntitlements(options: $options) {
      items { id customerId type resourceId source validFrom validUntil createdAt }
      totalItems
    }
  }
`);

const DELETE_ENTITLEMENT = graphql(`
  mutation DeleteBbbEntitlement($id: ID!) { deleteBbbEntitlement(id: $id) }
`);

const CREATE_ENTITLEMENT = graphql(`
  mutation ReGrantBbbEntitlement($input: CreateBbbEntitlementInput!) {
    createBbbEntitlement(input: $input) { id }
  }
`);

export function EntitlementsList() {
  const [page, setPage] = useState(1);
  const [customerIdFilter, setCustomerIdFilter] = useState('');
  // Revoked rows stay queryable (audit: who revoked, when) but are hidden by
  // default so the list answers "who has access", not "who ever had it".
  const [showRevoked, setShowRevoked] = useState(false);
  const pageSize = 25;

  const query = useQuery<any>({
    queryKey: ['bbbEntitlements', page, customerIdFilter],
    queryFn: () => api.query(GET_ENTITLEMENTS, {
      options: {
        skip: (page - 1) * pageSize,
        take: pageSize,
        // Exact-match probe (BbbEntitlementListOptions.filter). A shape the
        // schema rejects would fail the whole query — INV-015: that failure
        // must surface as an error state below, never as an empty table.
        filter: customerIdFilter ? { customerId: customerIdFilter } : undefined,
      }
    }),
  });
  const items = query.data?.bbbEntitlements?.items ?? [];
  const totalItems = query.data?.bbbEntitlements?.totalItems ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.mutate(DELETE_ENTITLEMENT, { id }),
    onSuccess: () => { query.refetch(); toast.success('Access revoked (row kept for audit)'); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const reGrantMutation = useMutation({
    mutationFn: (e: any) => api.mutate(CREATE_ENTITLEMENT, {
      input: { customerId: e.customerId, type: e.type, resourceId: e.resourceId, source: 'admin' },
    }),
    onSuccess: () => { query.refetch(); toast.success('Access re-granted'); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  function isValidNow(e: any) {
    const now = new Date();
    if (e.validFrom && new Date(e.validFrom) > now) return false;
    if (e.validUntil && new Date(e.validUntil) < now) return false;
    return true;
  }

  // Default view hides revoked rows; the toggle reveals them for audit.
  const visibleItems = (items as any[]).filter((e: any) => showRevoked || isValidNow(e));

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Entitlements</h1>

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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showRevoked}
              onChange={(e) => { setShowRevoked(e.target.checked); setPage(1); }}
            />
            Show revoked
          </label>
        </div>
      </Card>

      {query.isLoading ? (
        <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 w-full bg-muted animate-pulse rounded" />)}</div>
      ) : query.isError ? (
        // INV-015: a rejected operation is NOT an empty tenant. Show it.
        <div className="p-6 text-center text-red-500">
          Failed to load entitlements: {(query.error as Error)?.message ?? 'unknown error'}
        </div>
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
              {visibleItems.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">{e.customerId}</TableCell>
                  <TableCell><Badge>{e.type}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{e.resourceId}</TableCell>
                  <TableCell><Badge variant="outline">{e.source}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={isValidNow(e) ? 'success' : 'destructive'}>
                      {isValidNow(e) ? 'Active' : 'Revoked'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{e.validFrom ? new Date(e.validFrom).toLocaleDateString() : '—'}</TableCell>
                  <TableCell className="text-sm">{e.validUntil ? new Date(e.validUntil).toLocaleDateString() : 'Never'}</TableCell>
                  <TableCell className="text-sm">{new Date(e.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {isValidNow(e) ? (
                      <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(e.id)}>Revoke</Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => reGrantMutation.mutate(e)}>Re-grant</Button>
                    )}
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
    </div>
  );
}