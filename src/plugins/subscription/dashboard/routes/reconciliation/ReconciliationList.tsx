import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Badge, Card, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vendure/dashboard";
import { graphql } from "@/gql";

const GET_CHANNELS = graphql(`
  query GetChannelsForReconciliation {
    channels {
      items {
        id
        token
        code
      }
    }
  }
`);

/**
 * INV-001 (Channel = Tenant): the Dashboard always scopes this to one channel.
 * `reconciliationIncidents.channelId` is nullable in the schema so an operator
 * tooling script can request the platform-wide view, but the screen itself must
 * never blend tenants' financial failures together.
 */
const GET_INCIDENTS = graphql(`
  query GetReconciliationIncidents($channelId: String, $status: ReconciliationIncidentStatus) {
    reconciliationIncidents(channelId: $channelId, status: $status) {
      items {
        id
        channelId
        subscriptionId
        providerOrderId
        invoiceId
        detectedAt
        status
        resolutionNote
      }
      total
    }
  }
`);

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleString() : "—";
}

export function ReconciliationList() {
  const [channelId, setChannelId] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const channelsQuery = useQuery({
    queryKey: ["channelsForReconciliation"],
    queryFn: () => api.query(GET_CHANNELS),
  });
  const channels = channelsQuery.data?.channels?.items ?? [];

  useEffect(() => {
    if (!channelId && channels.length > 0) {
      setChannelId(channels[0].id);
    }
  }, [channelsQuery.data, channelId]);

  const query = useQuery({
    queryKey: ["reconciliationIncidents", channelId, statusFilter],
    queryFn: () =>
      api.query(GET_INCIDENTS, {
        channelId,
        status: statusFilter ? (statusFilter as "PENDING" | "RESOLVED") : undefined,
      }),
    enabled: !!channelId,
  });

  const incidents = query.data?.reconciliationIncidents?.items ?? [];
  const total = query.data?.reconciliationIncidents?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reconciliation Incidents</h1>
        <p className="text-muted-foreground">
          Charges that succeeded at the provider but the period did not advance. Requires manual operator resolution.
        </p>
      </div>

      <Card>
        <div className="p-4 flex flex-wrap gap-4 border-b">
          <div className="flex items-center gap-2">
            <label htmlFor="reconciliation-channel-select" className="text-sm font-medium text-muted-foreground">
              Channel:
            </label>
            <select
              id="reconciliation-channel-select"
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
            <label htmlFor="reconciliation-status-select" className="text-sm font-medium text-muted-foreground">
              Status:
            </label>
            <select
              id="reconciliation-status-select"
              className="border rounded px-3 py-1.5 text-sm bg-background"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>
        </div>

        {query.isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="p-6 text-center text-destructive">
            <p className="font-semibold">Unable to load reconciliation incidents</p>
            <p className="text-sm text-muted-foreground mt-1">
              {query.error instanceof Error ? query.error.message : "GraphQL query error"}
            </p>
          </div>
        ) : incidents.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            No reconciliation incidents for this channel. System healthy.
          </div>
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
              {incidents.map((inc) => (
                <TableRow key={inc.id}>
                  <TableCell>
                    <Badge variant={inc.status === "PENDING" ? "destructive" : "success"}>
                      {inc.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{inc.channelId}</TableCell>
                  <TableCell className="font-mono text-sm">{inc.subscriptionId}</TableCell>
                  <TableCell className="font-mono text-xs">{inc.providerOrderId}</TableCell>
                  <TableCell className="font-mono text-sm">{inc.invoiceId}</TableCell>
                  <TableCell className="text-sm">{fmtDate(inc.detectedAt)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {inc.resolutionNote ?? "—"}
                  </TableCell>
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
