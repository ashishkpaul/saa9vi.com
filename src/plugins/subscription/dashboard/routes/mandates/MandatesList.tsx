import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, Badge, Card, Input, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';

const GET_CHANNELS = `
  query GetChannels {
    channels { items { id token code } }
  }
`;

const GET_MANDATES = `
  query GetJuspayMandates($channelId: String!, $filter: JuspayMandateFilter) {
    juspayMandates(channelId: $channelId, filter: $filter) {
      items { id channelId juspayCustomerId mandateId status activatedAt revokedAt }
      total
    }
  }
`;

const STATUS_VARIANT: Record<string, string> = {
  pending: 'warning',
  active: 'success',
  paused: 'secondary',
  revoked: 'destructive',
};

function fmtDate(d: string) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

export function MandatesList() {
  const [channelId, setChannelId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const channelsQuery = useQuery({ queryKey: ['channelsForMandates'], queryFn: () => api.query(GET_CHANNELS) });
  const channels = channelsQuery.data?.channels?.items ?? [];

  useEffect(() => {
    if (!channelId && channels.length > 0) {
      setChannelId(channels[0].id);
    }
  }, [channelsQuery.data, channelId]);

  const mandatesQuery = useQuery({
    queryKey: ['juspayMandates', channelId, statusFilter],
    queryFn: () => api.query(GET_MANDATES, {
      channelId,
      filter: statusFilter ? { status: statusFilter } : undefined,
    }),
    enabled: !!channelId,
  });

  const mandates = mandatesQuery.data?.juspayMandates?.items ?? [];
  const total = mandatesQuery.data?.juspayMandates?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Juspay Mandates</h1>
        <p className="text-muted-foreground">Recurring payment mandates per tenant. Read-only — transitions driven by webhooks.</p>
      </div>

      <Card>
        <div className="p-4 flex gap-4 border-b">
          <select
            className="border rounded px-3 py-1.5 text-sm bg-background"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
          >
            {channels.map((c: any) => (
              <option key={c.id} value={c.id}>{c.code} ({c.id})</option>
            ))}
          </select>
          <Input
            placeholder="Filter by status..."
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="max-w-xs"
          />
        </div>
        {mandatesQuery.isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : mandates.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">No mandates for this channel.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mandate ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Activated</TableHead>
                <TableHead>Revoked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mandates.map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-sm">{m.mandateId ?? '—'}</TableCell>
                  <TableCell className="font-mono text-sm">{m.juspayCustomerId}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[m.status] ?? 'secondary'}>{m.status}</Badge></TableCell>
                  <TableCell className="text-sm">{fmtDate(m.activatedAt)}</TableCell>
                  <TableCell className="text-sm">{fmtDate(m.revokedAt)}</TableCell>
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
