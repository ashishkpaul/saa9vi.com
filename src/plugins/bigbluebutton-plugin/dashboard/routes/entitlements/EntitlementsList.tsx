import { useMutation, useQuery } from '@tanstack/react-query';
import { api, Badge, Button, Card, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';

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
    onSuccess: () => { query.refetch(); toast.success('Entitlement deleted'); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  function isValidNow(e: any) {
    const now = new Date();
    if (e.validFrom && new Date(e.validFrom) > now) return false;
    if (e.validUntil && new Date(e.validUntil) < now) return false;
    return true;
  }

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
                    <Badge variant={isValidNow(e) ? 'success' : 'warning'}>
                      {isValidNow(e) ? 'Active' : 'Expired'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{e.validFrom ? new Date(e.validFrom).toLocaleDateString() : '—'}</TableCell>
                  <TableCell className="text-sm">{e.validUntil ? new Date(e.validUntil).toLocaleDateString() : 'Never'}</TableCell>
                  <TableCell className="text-sm">{new Date(e.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(e.id)}>Delete</Button>
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