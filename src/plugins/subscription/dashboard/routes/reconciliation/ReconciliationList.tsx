import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, Badge, Card, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';

const GET_INCIDENTS = `
  query GetReconciliationIncidents($channelId: String, $status: ReconciliationIncidentStatus) {
    reconciliationIncidents(channelId: $channelId, status: $status) {
      items { id channelId subscriptionId invoiceId juspayOrderId detectedAt status resolutionNote }
      total
    }
  }
`;

function fmtDate(d: string) {
  return d ? new Date(d).toLocaleString() : '—';
}

export function ReconciliationList() {
  const [statusFilter, setStatusFilter] = useState<string>('');

  const query = useQuery({
    queryKey: ['reconciliationIncidents', statusFilter],
    queryFn: () => api.query(GET_INCIDENTS, {
      status: statusFilter || undefined,
    }),
  });

  const incidents = query.data?.reconciliationIncidents?.items ?? [];
  const total = query.data?.reconciliationIncidents?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reconciliation Incidents</h1>
        <p className="text-muted-foreground">Charges that succeeded at Juspay but the period did not advance. Requires manual operator resolution.</p>
      </div>

      <Card>
        <div className="p-4 border-b">
          <select
            className="border rounded px-3 py-1.5 text-sm bg-background"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </div>
        {query.isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : incidents.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">No reconciliation incidents. System healthy.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Detected</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incidents.map((inc: any) => (
                <TableRow key={inc.id}>
                  <TableCell>
                    <Badge variant={inc.status === 'PENDING' ? 'destructive' : 'success'}>{inc.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{inc.channelId}</TableCell>
                  <TableCell className="font-mono text-sm">{inc.subscriptionId}</TableCell>
                  <TableCell className="font-mono text-xs">{inc.juspayOrderId}</TableCell>
                  <TableCell className="font-mono text-sm">{inc.invoiceId}</TableCell>
                  <TableCell className="text-sm">{fmtDate(inc.detectedAt)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{inc.resolutionNote ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="p-3 border-t text-sm text-muted-foreground">{total} total</div>
      </Card>
    </div>
  );
}
