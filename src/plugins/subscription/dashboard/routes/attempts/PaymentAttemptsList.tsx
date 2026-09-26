import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Badge, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vendure/dashboard";
import { graphql } from "@/gql";

import { BILLING_ATTEMPT_STATUSES, humanizeStatus } from "../../../../../platform/dashboard/billing-vocabularies";
import { resolveListState } from "../../../../../platform/dashboard/query-state";
import { LedgerQueryError, LedgerStateView } from "../../shared/query-state-panel";

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
  const channelsState = resolveListState(channelsQuery, (data) => data.channels, {
    expected: "channels",
  });
  const channelOptions = channelsState.status === "ready" ? channelsState.items : [];

  // Derive the effective channel rather than mirroring it into state from an
  // effect: a disabled query reports isLoading === false, so the ledger would
  // otherwise render its empty state before anything was requested.
  const activeChannelId = channelId || channelOptions[0]?.id || "";

  const attemptsQuery = useQuery({
    queryKey: ["providerAttempts", activeChannelId, statusFilter],
    queryFn: () =>
      api.query(GET_ATTEMPTS, {
        channelId: activeChannelId,
        filter: statusFilter ? { status: statusFilter } : undefined,
      }),
    enabled: !!activeChannelId,
  });

  const attemptsState = resolveListState(attemptsQuery, (data) => data.providerPaymentAttempts, {
    blocked: !activeChannelId,
    expected: "providerPaymentAttempts",
  });

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
              Options come from BILLING_ATTEMPT_STATUSES — the exact
              `SubscriptionBillingAttempt.status` vocabulary (INV-002). A filter
              value the ledger cannot hold would answer with an empty table and
              read as "no attempts" (INV-015).
            */}
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
              {BILLING_ATTEMPT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {humanizeStatus(status)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/*
          The channel list gates the ledger query. While it is unresolved (or if
          it failed) the ledger was never requested, so it must not render its
          empty state.
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
            state={attemptsState}
            errorTitle="Unable to load payment attempts"
            emptyMessage="No payment attempts for this channel."
            blockedMessage="Select a channel to view its payment attempts."
          >
            {(attempts, total) => (
              <>
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
                          <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>{a.status}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{a.providerPaymentId ?? "—"}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {a.invoiceId ?? a.providerInvoiceId ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">{a.billingPeriodStart ?? "—"}</TableCell>
                        <TableCell>₹{toRupees(a.amountPaise)}</TableCell>
                        <TableCell className="text-sm text-destructive">{a.failureReason ?? "—"}</TableCell>
                        <TableCell className="text-sm">{fmtDate(a.attemptedAt)}</TableCell>
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

