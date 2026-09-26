import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Badge, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vendure/dashboard";
import { graphql } from "@/gql";

import {
  RECONCILIATION_INCIDENT_STATUSES,
  humanizeStatus,
  type ReconciliationIncidentStatusOption,
} from "../../../../../platform/dashboard/billing-vocabularies";
import { resolveListState } from "../../../../../platform/dashboard/query-state";
import { LedgerQueryError, LedgerStateView } from "../../shared/query-state-panel";

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
  const [statusFilter, setStatusFilter] = useState<ReconciliationIncidentStatusOption | "">("");

  const channelsQuery = useQuery({
    queryKey: ["channelsForReconciliation"],
    queryFn: () => api.query(GET_CHANNELS),
  });
  const channelsState = resolveListState(channelsQuery, (data) => data.channels, {
    expected: "channels",
  });
  const channelOptions = channelsState.status === "ready" ? channelsState.items : [];

  // Derive the effective channel rather than mirroring it into state from an
  // effect: a disabled query reports isLoading === false, so the ledger would
  // otherwise render "no incidents — system healthy" before anything was asked.
  const activeChannelId = channelId || channelOptions[0]?.id || "";

  const query = useQuery({
    queryKey: ["reconciliationIncidents", activeChannelId, statusFilter],
    queryFn: () =>
      api.query(GET_INCIDENTS, {
        channelId: activeChannelId,
        status: statusFilter || undefined,
      }),
    enabled: !!activeChannelId,
  });

  const incidentsState = resolveListState(query, (data) => data.reconciliationIncidents, {
    blocked: !activeChannelId,
    expected: "reconciliationIncidents",
  });

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
              value={activeChannelId}
              disabled={channelOptions.length === 0}
              onChange={(e) => setChannelId(e.target.value)}
            >
              {channelOptions.length === 0 ? (
                <option value="">—</option>
              ) : (
                channelOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} ({c.id})
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex items-center gap-2">
            {/*
              Options come from RECONCILIATION_INCIDENT_STATUSES, mirroring the
              schema's ReconciliationIncidentStatus enum: an operator can only
              filter by values the incident can actually hold (INV-015).
            */}
            <label htmlFor="reconciliation-status-select" className="text-sm font-medium text-muted-foreground">
              Status:
            </label>
            <select
              id="reconciliation-status-select"
              className="border rounded px-3 py-1.5 text-sm bg-background"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ReconciliationIncidentStatusOption | "")}
            >
              <option value="">All statuses</option>
              {RECONCILIATION_INCIDENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {humanizeStatus(status.toLowerCase())}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/*
          The channel list gates the incident query. "System healthy" may only be
          claimed by a successful query that returned zero rows — never by a
          query whose precondition was unmet or whose request failed (INV-015).
        */}
        {channelsState.status === "loading" ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : channelsState.status === "error" ? (
          <LedgerQueryError
            title="Unable to load channels"
            message={channelsState.message}
            onRetry={channelsState.retry}
          />
        ) : channelsState.status === "empty" ? (
          <div className="p-6 text-center text-muted-foreground">
            No channels are available for your account.
          </div>
        ) : (
          <LedgerStateView
            state={incidentsState}
            errorTitle="Unable to load reconciliation incidents"
            emptyMessage="No reconciliation incidents for this channel. System healthy."
            blockedMessage="Select a channel to view its reconciliation incidents."
          >
            {(incidents, total) => (
              <>
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
                <div className="p-3 border-t text-sm text-muted-foreground">{total} total</div>
              </>
            )}
          </LedgerStateView>
        )}
      </Card>
    </div>
  );
}

