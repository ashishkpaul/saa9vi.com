import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Badge, Card, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vendure/dashboard";
import { graphql } from "@/gql";

const GET_CHANNELS = graphql(`
  query GetChannelsForMandates {
    channels {
      items {
        id
        token
        code
      }
    }
  }
`);

const GET_MANDATES = graphql(`
  query GetBillingMandates($channelId: String!, $filter: ProviderMandateFilter) {
    providerMandates(channelId: $channelId, filter: $filter) {
      items {
        id
        channelId
        subscriptionId
        provider
        providerSubscriptionId
        providerPlanId
        providerStatus
        active
        createdAt
        updatedAt
      }
      total
    }
  }
`);

const STATUS_VARIANT: Record<string, "warning" | "success" | "secondary" | "destructive"> = {
  created: "warning",
  authenticated: "warning",
  active: "success",
  pending: "warning",
  halted: "destructive",
  cancelled: "secondary",
  completed: "secondary",
  expired: "destructive",
};

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

export function MandatesList() {
  const [channelId, setChannelId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const channelsQuery = useQuery({
    queryKey: ["channelsForMandates"],
    queryFn: () => api.query(GET_CHANNELS),
  });
  const channels = channelsQuery.data?.channels?.items ?? [];

  useEffect(() => {
    if (!channelId && channels.length > 0) {
      setChannelId(channels[0].id);
    }
  }, [channelsQuery.data, channelId]);

  const mandatesQuery = useQuery({
    queryKey: ["providerMandates", channelId, statusFilter],
    queryFn: () =>
      api.query(GET_MANDATES, {
        channelId,
        filter: statusFilter ? { status: statusFilter } : undefined,
      }),
    enabled: !!channelId,
  });

  const mandates = mandatesQuery.data?.providerMandates?.items ?? [];
  const total = mandatesQuery.data?.providerMandates?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Recurring Payment Mandates</h1>
        <p className="text-muted-foreground">
          Recurring payment mandates per tenant. Read-only — transitions driven by webhooks.
        </p>
      </div>

      <Card>
        <div className="p-4 flex flex-wrap gap-4 border-b">
          <div className="flex items-center gap-2">
            <label htmlFor="mandates-channel-select" className="text-sm font-medium text-muted-foreground">
              Channel:
            </label>
            <select
              id="mandates-channel-select"
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
            <label htmlFor="mandates-status-select" className="text-sm font-medium text-muted-foreground">
              Status:
            </label>
            <select
              id="mandates-status-select"
              className="border rounded px-3 py-1.5 text-sm bg-background"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="created">Created</option>
              <option value="authenticated">Authenticated</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="halted">Halted</option>
              <option value="cancelled">Cancelled</option>
              <option value="completed">Completed</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </div>

        {mandatesQuery.isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : mandatesQuery.isError ? (
          <div className="p-6 text-center text-destructive">
            <p className="font-semibold">Unable to load payment mandates</p>
            <p className="text-sm text-muted-foreground mt-1">
              {mandatesQuery.error instanceof Error ? mandatesQuery.error.message : "GraphQL query error"}
            </p>
          </div>
        ) : mandates.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            No mandates found for this channel.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider Sub ID</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Plan ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mandates.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-sm">{m.providerSubscriptionId}</TableCell>
                  <TableCell className="text-sm">{m.provider}</TableCell>
                  <TableCell className="font-mono text-xs">{m.providerPlanId ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[m.providerStatus] ?? "secondary"}>
                      {m.providerStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.active ? "success" : "secondary"}>
                      {m.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{fmtDate(m.createdAt)}</TableCell>
                  <TableCell className="text-sm">{fmtDate(m.updatedAt)}</TableCell>
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
