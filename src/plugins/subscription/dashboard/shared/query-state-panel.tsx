import type { ReactNode } from 'react';
import { Button, Skeleton } from '@vendure/dashboard';

import type { ListState } from '../../../../platform/dashboard/query-state';

/**
 * Shared render surface for billing ledgers (INV-015).
 *
 * Every ledger screen renders through `LedgerStateView`, so the invariant
 * "a query failure is never shown as an empty dataset" has exactly one
 * implementation:
 *
 *   loading → skeleton
 *   error   → explicit error panel + Retry (role="alert")
 *   blocked → "select a channel" hint (the query never ran)
 *   empty   → the screen's empty message (only reachable from a real 0-row success)
 *   ready   → the caller's table, plus its own total/footer row
 *
 * The footer lives inside the `ready` branch on purpose: printing "0 total"
 * underneath a failed query is the same false signal as an empty table.
 */

export function LedgerQueryError({
    title,
    message,
    onRetry,
}: Readonly<{
    title: string;
    message: string;
    onRetry?: () => void;
}>) {
    return (
        <div className="p-6 text-center text-destructive" role="alert">
            <p className="font-semibold">{title}</p>
            <p className="text-sm text-muted-foreground mt-1">{message}</p>
            <p className="text-xs text-muted-foreground mt-2">
                The Billing API request did not succeed — this is not an empty ledger.
            </p>
            {onRetry ? (
                <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
                    Retry
                </Button>
            ) : null}
        </div>
    );
}

export function LedgerStateView<TItem>({
    state,
    errorTitle,
    emptyMessage,
    blockedMessage = 'Select a channel to view this ledger.',
    loadingRows = 3,
    children,
}: Readonly<{
    state: ListState<TItem>;
    /** Shown when the query itself failed (rejection, auth, network). */
    errorTitle: string;
    /** Shown ONLY for a successful response that genuinely has zero rows. */
    emptyMessage: string;
    /** Shown when the query was deliberately not issued. */
    blockedMessage?: string;
    loadingRows?: number;
    children: (items: readonly TItem[], total: number) => ReactNode;
}>) {
    switch (state.status) {
        case 'loading':
            return (
                <div className="p-4 space-y-3">
                    {Array.from({ length: loadingRows }).map((_, index) => (
                        <Skeleton key={index} className="h-10 w-full" />
                    ))}
                </div>
            );
        case 'error':
            return <LedgerQueryError title={errorTitle} message={state.message} onRetry={state.retry} />;
        case 'blocked':
            return <div className="p-6 text-center text-muted-foreground">{blockedMessage}</div>;
        case 'empty':
            return <div className="p-6 text-center text-muted-foreground">{emptyMessage}</div>;
        case 'ready':
            return <>{children(state.items, state.total)}</>;
        default: {
            // Exhaustiveness guard: a new ListState member must be handled here,
            // otherwise this assignment stops compiling.
            const unhandled: never = state;
            return unhandled;
        }
    }
}
