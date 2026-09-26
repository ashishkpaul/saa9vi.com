/**
 * Billing-ledger query-state resolution (INV-015).
 *
 * WHY THIS EXISTS
 * ---------------
 * INV-015 states that a Dashboard GraphQL rejection must never be rendered as an
 * empty dataset. Three distinct situations collapse into "0 records" when a
 * screen derives its rows inline (`const items = data?.list?.items ?? []`):
 *
 *   1. REJECTED OPERATION — an unknown field, an authorization failure or a
 *      network error means there is no successful result at all. `data` is
 *      `undefined`, which an inline fallback turns into an empty list.
 *   2. QUERY NEVER RAN — the screen has no channel yet, so the query is
 *      disabled. TanStack reports `isLoading === false` for a disabled query
 *      (`isPending && isFetching`), so the usual
 *      `isLoading ? skeleton : items.length === 0 ? <empty> : …` ladder prints
 *      "no records" while nothing was ever requested.
 *   3. UNEXPECTED RESPONSE SHAPE — the field the screen reads is renamed or
 *      absent. `data?.oldName?.items ?? []` is empty, not broken, so the screen
 *      silently claims the tenant has no rows.
 *
 * `resolveListState` is the ONE place where missing-item normalisation happens,
 * and it separates all three cases from a genuine zero-row success. It is a pure
 * function (no React, no network, no `@vendure/dashboard` import) so the rule
 * can be unit-tested directly: see `__tests__/dashboard-query-state.spec.ts`.
 */

/**
 * Structural subset of a TanStack `useQuery` result. Declared structurally so
 * this module stays free of React/@tanstack imports and can be unit-tested in
 * a plain Node environment.
 */
export interface LedgerQueryLike<TData> {
    /** True only while the first fetch of an ENABLED query is in flight. */
    readonly isLoading: boolean;
    readonly isError: boolean;
    readonly error: unknown;
    readonly data: TData | undefined;
    /** Exposed on the error state so the UI can offer an explicit Retry. */
    readonly refetch?: (...args: never[]) => unknown;
}

/** A paginated list payload, e.g. `ProviderMandateList`. */
export interface ListPayload<TItem> {
    readonly items?: readonly TItem[] | null;
    readonly total?: number | null;
}

/**
 * The set of states a list screen may render. `empty` is reachable ONLY from a
 * successful response whose list field is present and actually empty.
 */
export type ListState<TItem> =
    | { readonly status: 'loading' }
    | { readonly status: 'error'; readonly message: string; readonly retry?: () => void }
    /** The query is deliberately not running (no channel resolved). */
    | { readonly status: 'blocked' }
    | { readonly status: 'empty' }
    | { readonly status: 'ready'; readonly items: readonly TItem[]; readonly total: number };

export interface ResolveListStateOptions {
    /**
     * The caller knows the query is not applicable (e.g. no channel selected).
     * Takes precedence over every other signal: an idle query reports
     * `isLoading === false` with no data, and that must never read as "no rows".
     */
    blocked?: boolean;
    /** Field path used in shape-mismatch messages, e.g. `providerMandates`. */
    expected?: string;
}

/**
 * Human-readable message for an unknown thrown value.
 *
 * Operational safety: only `message`/`name` are read. Provider payloads, request
 * bodies and credentials are never stringified into the UI.
 */
export function describeQueryError(error: unknown): string {
    const fallback = 'The Billing API request failed.';

    if (error === null || error === undefined) {
        return fallback;
    }
    if (typeof error === 'string') {
        return error.trim() || fallback;
    }
    if (error instanceof Error) {
        return error.message || fallback;
    }
    if (Array.isArray(error)) {
        const messages = error.map(describeQueryError).filter(message => message !== fallback);
        return messages.length > 0 ? messages.join('; ') : fallback;
    }
    if (typeof error === 'object') {
        const maybe = error as { message?: unknown };
        if (typeof maybe.message === 'string' && maybe.message.trim()) {
            return maybe.message;
        }
    }
    return fallback;
}

/**
 * Reads the item array out of a response payload.
 *
 * Returns `null` — which the caller reports as a shape error — when the payload
 * does not carry an array. Only an object whose `items` really is an array, or a
 * bare array, counts as a list; anything else must not be mistaken for "empty".
 */
function readItems<TItem>(payload: ListPayload<TItem> | readonly TItem[]): readonly TItem[] | null {
    if (Array.isArray(payload)) {
        return payload as readonly TItem[];
    }
    // Not an array: the only remaining valid shape is a list payload whose
    // `items` really is an array. Anything else is a shape mismatch.
    const candidate = payload as ListPayload<TItem>;
    return Array.isArray(candidate.items) ? candidate.items : null;
}

function readTotal<TItem>(
    payload: ListPayload<TItem> | readonly TItem[],
    itemCount: number,
): number {
    if (Array.isArray(payload)) {
        return itemCount;
    }
    const total = (payload as ListPayload<TItem>).total;
    return typeof total === 'number' && Number.isFinite(total) ? total : itemCount;
}

function makeRetry<TData>(query: LedgerQueryLike<TData>): (() => void) | undefined {
    const refetch = query.refetch;
    if (typeof refetch !== 'function') {
        return undefined;
    }
    return () => {
        void refetch();
    };
}

/**
 * Classifies a list query into exactly one render state.
 *
 * Precedence (each step is a deliberate safety decision):
 *   1. `blocked`      — the caller declared the query inapplicable.
 *   2. `isError`      — a rejection outranks any data, including partial data
 *                       left over from a previous successful fetch.
 *   3. `isLoading` / `data === undefined` — still unsettled (an idle disabled
 *                       query lands here, never on `empty`).
 *   4. shape failure  — the selected field is absent or is not a list.
 *   5. `empty`        — a real list came back with zero items.
 *   6. `ready`.
 */
export function resolveListState<TData, TItem>(
    query: LedgerQueryLike<TData>,
    select: (data: TData) => ListPayload<TItem> | readonly TItem[] | null | undefined,
    options: ResolveListStateOptions = {},
): ListState<TItem> {
    if (options.blocked) {
        return { status: 'blocked' };
    }

    if (query.isError) {
        return {
            status: 'error',
            message: describeQueryError(query.error),
            retry: makeRetry(query),
        };
    }

    if (query.isLoading || query.data === undefined) {
        return { status: 'loading' };
    }

    let payload: ListPayload<TItem> | readonly TItem[] | null | undefined;
    try {
        payload = select(query.data);
    } catch (error) {
        return {
            status: 'error',
            message: describeQueryError(error),
            retry: makeRetry(query),
        };
    }

    const where = options.expected ? ` for \`${options.expected}\`` : '';

    if (payload === null || payload === undefined) {
        return {
            status: 'error',
            message: `Unexpected response shape${where}: the expected list field was absent.`,
            retry: makeRetry(query),
        };
    }

    const items = readItems(payload);
    if (items === null) {
        return {
            status: 'error',
            message: `Unexpected response shape${where}: the expected list field was not a list.`,
            retry: makeRetry(query),
        };
    }

    if (items.length === 0) {
        return { status: 'empty' };
    }

    return { status: 'ready', items, total: readTotal(payload, items.length) };
}

