import { useQuery } from '@tanstack/react-query';
import { ExternalLinkIcon } from 'lucide-react';
import { api, Badge, Card, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';

const GET_SUBSCRIPTIONS = `
  query GetOrganizationSubscriptions {
    organizationSubscriptions {
      id
      channelId
      status
      providerStatus
      providerShortUrl
      currentPeriodStart
      currentPeriodEnd
      plan { id name slug monthlyPriceInPaise providerPlanId }
    }
  }
`;

const STATUS_VARIANT: Record<string, string> = {
  pending_provider_auth: 'warning',
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
                <TableHead>Provider</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Authorization</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.plan?.name ?? '—'}</TableCell>
                  <TableCell className="text-sm">{s.channelId}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[s.status] ?? 'secondary'}>{s.status}</Badge></TableCell>
                  <TableCell className="text-sm">{s.providerStatus ?? '—'}</TableCell>
                  <TableCell>₹{toRupees(s.plan?.monthlyPriceInPaise)}/mo</TableCell>
                  <TableCell className="text-sm">{fmtDate(s.currentPeriodStart)} → {fmtDate(s.currentPeriodEnd)}</TableCell>
                  <TableCell>
                    {/* ADR-039 trust boundary: the short_url is the customer
                        authorization URL. The Dashboard only links out — the
                        authoritative pending_provider_auth → active transition
                        happens via the Razorpay webhook, never locally. */}
                    {s.status === 'pending_provider_auth' && s.providerShortUrl ? (
                      <a
                        href={s.providerShortUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary underline underline-offset-4"
                      >
                        Complete authorization <ExternalLinkIcon className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
