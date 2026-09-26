import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Badge, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vendure/dashboard";
import { graphql } from "@/gql";

import { PROVIDER_SUBSCRIPTION_STATUSES, humanizeStatus } from "../../../../../platform/dashboard/billing-vocabularies";
import { resolveListState } from "../../../../../platform/dashboard/query-state";
import { LedgerQueryError, LedgerStateView } from "../../shared/query-state-panel";

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
  const channelsState = resolveListState(channelsQuery, (data) => data.channels, {
    expected: "channels",
  });
  const channelOptions = channelsState.status === "ready" ? channelsState.items : [];

  // Derive the effective channel instead of mirroring it into state from an
  // effect: an effect leaves the ledger query disabled for one render after the
  // channels arrive, and a disabled query reports isLoading === false — which is
  // exactly how a pending screen used to print "no mandates found".
  const activeChannelId = channelId || channelOptions[0]?.id || "";

  const mandatesQuery = useQuery({
    queryKey: ["providerMandates", activeChannelId, statusFilter],
    queryFn: () =>
      api.query(GET_MANDATES, {
        channelId: activeChannelId,
        filter: statusFilter ? { status: statusFilter } : undefined,
      }),
    enabled: !!activeChannelId,
  });

  const mandatesState = resolveListState(mandatesQuery, (data) => data.providerMandates, {
    blocked: !activeChannelId,
    expected: "providerMandates",
  });

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
              Filters on the binding's provider status; the `active` flag is a
              separate column and is never conflated with this filter. Options
              come from PROVIDER_SUBSCRIPTION_STATUSES — only statuses the
              provider lifecycle actually persists (INV-015), because a
              selectable status no code path writes always answers with an empty
              table.
            */}
            <label htmlFor="mandates-status-select" className="text-sm font-medium text-muted-foreground">
              Provider status:
            </label>
            <select
              id="mandates-status-select"
              className="border rounded px-3 py-1.5 text-sm bg-background"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              {PROVIDER_SUBSCRIPTION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {humanizeStatus(status)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/*
          The channel list is the ledger's precondition: if it is still loading or
          failed, the ledger query never runs and must not be rendered as "no
          mandates". Each channel-query outcome therefore has its own branch.
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
            state={mandatesState}
            errorTitle="Unable to load payment mandates"
            emptyMessage="No mandates found for this channel."
            blockedMessage="Select a channel to view its payment mandates."
          >
            {(mandates, total) => (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider Sub ID</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Plan ID</TableHead>
                      <TableHead>Provider Status</TableHead>
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
                <div className="p-3 border-t text-sm text-muted-foreground">{total} total</div>
              </>
            )}
          </LedgerStateView>
        )}
      </Card>
    </div>
  );
}

