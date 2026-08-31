import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, Badge, Card, Input, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';

const GET_CHANNELS = `
  query GetChannels {
    channels { items { id token code } }
  }
`;

const GET_ATTEMPTS = `
  query GetJuspayPaymentAttempts($channelId: String!, $filter: JuspayPaymentAttemptFilter) {
    juspayPaymentAttempts(channelId: $channelId, filter: $filter) {
      items { id invoiceId billingPeriodStart amountPaise status juspayOrderId juspayTransactionId failureReason attemptedAt }
      total
    }
  }
`;

const STATUS_VARIANT: Record<string, string> = {
  initiated: 'warning',
  succeeded: 'success',
  failed: 'destructive',
};

function toRupees(paise: number) {
  return ((paise ?? 0) / 100).toFixed(2);
}

function fmtDate(d: string) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

export function PaymentAttemptsList() {
  const [channelId, setChannelId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const channelsQuery = useQuery({ queryKey: ['channelsForAttempts'], queryFn: () => api.query(GET_CHANNELS) });
  const channels = channelsQuery.data?.channels?.items ?? [];

  useEffect(() => {
    if (!channelId && channels.length > 0) {
      setChannelId(channels[0].id);
    }
  }, [channelsQuery.data, channelId]);

  const attemptsQuery = useQuery({
    queryKey: ['juspayPaymentAttempts', channelId, statusFilter],
    queryFn: () => api.query(GET_ATTEMPTS, {
      channelId,
      filter: statusFilter ? { status: statusFilter } : undefined,
    }),
    enabled: !!channelId,
  });

  const attempts = attemptsQuery.data?.juspayPaymentAttempts?.items ?? [];
  const total = attemptsQuery.data?.juspayPaymentAttempts?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payment Attempts</h1>
        <p className="text-muted-foreground">Immutable ledger of Juspay charge attempts. INV-002: read-only financial facts.</p>
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
        {attemptsQuery.isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : attempts.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">No payment attempts for this channel.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Txn ID</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Attempted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell><Badge variant={STATUS_VARIANT[a.status] ?? 'secondary'}>{a.status}</Badge></TableCell>
                  <TableCell className="font-mono text-sm">{a.invoiceId}</TableCell>
                  <TableCell className="text-sm">{a.billingPeriodStart}</TableCell>
                  <TableCell>₹{toRupees(a.amountPaise)}</TableCell>
                  <TableCell className="font-mono text-xs">{a.juspayOrderId ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{a.juspayTransactionId ?? '—'}</TableCell>
                  <TableCell className="text-sm text-red-500">{a.failureReason ?? '—'}</TableCell>
                  <TableCell className="text-sm">{fmtDate(a.attemptedAt)}</TableCell>
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
