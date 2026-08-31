import { useQuery } from '@tanstack/react-query';
import { api, Badge, Card, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';

const GET_SUBSCRIPTIONS = `
  query GetOrganizationSubscriptions {
    organizationSubscriptions {
      id
      channelId
      status
      currentPeriodStart
      currentPeriodEnd
      plan { id name slug monthlyPriceInPaise }
    }
  }
`;

const STATUS_VARIANT: Record<string, string> = {
  trialing: 'warning',
  active: 'success',
  past_due: 'destructive',
  cancelled: 'secondary',
};

function toRupees(paise: number) {
  return ((paise ?? 0) / 100).toFixed(2);
}

function fmtDate(d: string) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

export function SubscriptionsList() {
  const query = useQuery({
    queryKey: ['organizationSubscriptions'],
    queryFn: () => api.query(GET_SUBSCRIPTIONS),
  });

  const subs = query.data?.organizationSubscriptions ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Organization Subscriptions</h1>
        <p className="text-muted-foreground">Tenant SaaS subscriptions across all channels. Read-only ledger.</p>
      </div>

      <Card>
        {query.isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : subs.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">No subscriptions found.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Period</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.plan?.name ?? '—'}</TableCell>
                  <TableCell className="text-sm">{s.channelId}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[s.status] ?? 'secondary'}>{s.status}</Badge></TableCell>
                  <TableCell>₹{toRupees(s.plan?.monthlyPriceInPaise)}/mo</TableCell>
                  <TableCell className="text-sm">{fmtDate(s.currentPeriodStart)} → {fmtDate(s.currentPeriodEnd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
