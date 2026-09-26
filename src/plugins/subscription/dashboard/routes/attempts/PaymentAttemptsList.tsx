import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Badge, Card, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vendure/dashboard";
import { graphql } from "@/gql";

const GET_CHANNELS = graphql(`
  query GetChannelsForAttempts {
    channels {
      items {
        id
        token
        code
      }
    }
  }
`);

const GET_ATTEMPTS = graphql(`
  query GetProviderPaymentAttempts($channelId: String!, $filter: ProviderPaymentAttemptFilter) {
    providerPaymentAttempts(channelId: $channelId, filter: $filter) {
      items {
        id
        channelId
        subscriptionId
        provider
        providerSubscriptionId
        providerPaymentId
        providerInvoiceId
        providerEventId
        providerAttemptId
        invoiceId
        billingPeriodStart
        amountPaise
        status
        failureReason
        attemptedAt
      }
      total
    }
  }
`);

const STATUS_VARIANT: Record<string, "warning" | "success" | "destructive" | "secondary"> = {
  initiated: "warning",
  succeeded: "success",
  failed: "destructive",
};

function toRupees(paise: number) {
  return ((paise ?? 0) / 100).toFixed(2);
}

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

export function PaymentAttemptsList() {
  const [channelId, setChannelId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const channelsQuery = useQuery({
    queryKey: ["channelsForAttempts"],
    queryFn: () => api.query(GET_CHANNELS),
  });
  const channels = channelsQuery.data?.channels?.items ?? [];

  useEffect(() => {
    if (!channelId && channels.length > 0) {
      setChannelId(channels[0].id);
    }
  }, [channelsQuery.data, channelId]);

  const attemptsQuery = useQuery({
    queryKey: ["providerAttempts", channelId, statusFilter],
    queryFn: () =>
      api.query(GET_ATTEMPTS, {
        channelId,
        filter: statusFilter ? { status: statusFilter } : undefined,
      }),
    enabled: !!channelId,
  });

  const attempts = attemptsQuery.data?.providerPaymentAttempts?.items ?? [];
  const total = attemptsQuery.data?.providerPaymentAttempts?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payment Attempts</h1>
        <p className="text-muted-foreground">
          Immutable ledger of provider charge attempts. INV-002: read-only financial facts.
        </p>
      </div>

      <Card>
        <div className="p-4 flex flex-wrap gap-4 border-b">
          <div className="flex items-center gap-2">
            <label htmlFor="attempts-channel-select" className="text-sm font-medium text-muted-foreground">
              Channel:
            </label>
            <select
              id="attempts-channel-select"
              className="border rounded px-3 py-1.5 text-sm bg-background"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} ({c.id})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="attempts-status-select" className="text-sm font-medium text-muted-foreground">
              Status:
            </label>
            <select
              id="attempts-status-select"
              className="border rounded px-3 py-1.5 text-sm bg-background"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="initiated">Initiated</option>
              <option value="succeeded">Succeeded</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        {attemptsQuery.isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : attemptsQuery.isError ? (
          <div className="p-6 text-center text-destructive">
            <p className="font-semibold">Unable to load payment attempts</p>
            <p className="text-sm text-muted-foreground mt-1">
              {attemptsQuery.error instanceof Error ? attemptsQuery.error.message : "GraphQL query error"}
            </p>
          </div>
        ) : attempts.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            No payment attempts for this channel.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Payment ID</TableHead>
                <TableHead>Invoice ID</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Attempted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{a.providerPaymentId ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{a.invoiceId ?? a.providerInvoiceId ?? "—"}</TableCell>
                  <TableCell className="text-sm">{a.billingPeriodStart ?? "—"}</TableCell>
                  <TableCell>₹{toRupees(a.amountPaise)}</TableCell>
                  <TableCell className="text-sm text-destructive">{a.failureReason ?? "—"}</TableCell>
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
