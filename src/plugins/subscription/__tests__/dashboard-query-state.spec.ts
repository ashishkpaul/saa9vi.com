/**
 * INV-015 — the Dashboard must never render a failed query as an empty dataset.
 *
 * Three layers of enforcement, all in this file:
 *
 *   A. `resolveListState` — the single place a ledger screen turns a query into
 *      a render state. Unit-tested here for every outcome, including the
 *      disabled-query case that used to print "no records" before anything was
 *      requested.
 *   B. Vocabularies — the status options the filter controls offer are re-derived
 *      from the code that writes them, so a phantom option (one the backend can
 *      never produce, which always answers with an empty table) cannot be added.
 *   C. Structural ratchet — list screens that fall back to `.items ?? []` without
 *      an error branch. The baseline below may only shrink.
 *
 * Run:
 *   npx vitest run --config vitest.config.mts \
 *     src/plugins/subscription/__tests__/dashboard-query-state.spec.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

import {
    BILLING_ATTEMPT_STATUSES,
    PROVIDER_SUBSCRIPTION_STATUSES,
    RECONCILIATION_INCIDENT_STATUSES,
    humanizeStatus,
} from '../../../platform/dashboard/billing-vocabularies';
import {
    describeQueryError,
    resolveListState,
    type LedgerQueryLike,
    type ListPayload,
} from '../../../platform/dashboard/query-state';

/** Repository root: src/plugins/subscription/__tests__ → up four levels. */
const ROOT = path.resolve(__dirname, '../../../..');

const DASHBOARD_GLOB_ROOT = path.join(ROOT, 'src/plugins');
const BILLING_SCREENS = [
    'src/plugins/subscription/dashboard/routes/subscriptions/SubscriptionsList.tsx',
    'src/plugins/subscription/dashboard/routes/mandates/MandatesList.tsx',
    'src/plugins/subscription/dashboard/routes/attempts/PaymentAttemptsList.tsx',
    'src/plugins/subscription/dashboard/routes/reconciliation/ReconciliationList.tsx',
];

/** Minimal stand-in for a TanStack query result. */
function makeQuery<TData>(
    state: Partial<LedgerQueryLike<TData>> = {},
): LedgerQueryLike<TData> {
    return {
        isLoading: false,
        isError: false,
        error: null,
        data: undefined,
        ...state,
    };
}

/** Reads every file under every plugin's `dashboard/` folder. */
function dashboardFiles(): string[] {
    const results: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
                results.push(path.relative(ROOT, full));
            }
        }
    };

    for (const plugin of fs.readdirSync(DASHBOARD_GLOB_ROOT)) {
        const dashboard = path.join(DASHBOARD_GLOB_ROOT, plugin, 'dashboard');
        if (fs.existsSync(dashboard)) {
            walk(dashboard);
        }
    }
    return results.sort();
}

interface Mandate {
    id: string;
    providerStatus: string;
}

/** Shape of the `providerMandates` selection as the screen reads it. */
interface MandatesData {
    providerMandates?: ListPayload<Mandate> | null;
}

const selectMandates = (data: MandatesData): ListPayload<Mandate> | null | undefined =>
    data.providerMandates;

const ROWS: Mandate[] = [
    { id: '1', providerStatus: 'active' },
    { id: '2', providerStatus: 'halted' },
];

describe('A. resolveListState — a failed query is never an empty dataset (INV-015)', () => {
    it('loads while an enabled query is in flight', () => {
        const state = resolveListState(makeQuery<MandatesData>({ isLoading: true }), selectMandates);
        expect(state.status).toBe('loading');
    });

    it('treats a query that has not run yet as loading, never as empty', () => {
        // The disabled-query shape: TanStack reports isLoading === false when the
        // query is disabled (`isPending && isFetching`), with no data at all.
        // Rendering "no mandates" in this state was the production defect.
        const state = resolveListState(makeQuery<MandatesData>(), selectMandates);
        expect(state.status).toBe('loading');
    });

    it('reports a rejected operation with its message and a retry action', () => {
        const refetch = vi.fn();
        const state = resolveListState(
            makeQuery<MandatesData>({
                isError: true,
                error: new Error('Cannot query field "mandateId" on type "ProviderMandate".'),
                refetch,
            }),
            selectMandates,
        );

        expect(state.status).toBe('error');
        if (state.status !== 'error') {
            throw new Error('expected an error state');
        }
        expect(state.message).toContain('mandateId');
        state.retry?.();
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('lets a rejection outrank data left over from an earlier fetch', () => {
        const state = resolveListState(
            makeQuery({
                isError: true,
                error: new Error('Network request failed'),
                data: { providerMandates: { items: ROWS, total: 2 } },
            }),
            selectMandates,
        );
        expect(state.status).toBe('error');
    });

    it('reports a shape mismatch instead of an empty list when the field is absent', () => {
        // e.g. the schema renames `providerMandates` — the screen must complain,
        // not silently claim the channel has no mandates.
        const state = resolveListState(
            makeQuery({ data: {} as MandatesData }),
            selectMandates,
            { expected: 'providerMandates' },
        );

        expect(state.status).toBe('error');
        if (state.status !== 'error') {
            throw new Error('expected an error state');
        }
        expect(state.message).toContain('providerMandates');
    });

    it('reports a shape mismatch when `items` is not a list', () => {
        const state = resolveListState(
            makeQuery({ data: { providerMandates: { items: 'nope' } } as unknown as MandatesData }),
            selectMandates,
        );
        expect(state.status).toBe('error');
    });

    it('reports a shape mismatch when `items` is missing from the payload', () => {
        const state = resolveListState(
            makeQuery({ data: { providerMandates: { total: 7 } } as MandatesData }),
            selectMandates,
        );
        expect(state.status).toBe('error');
    });

    it('reports empty ONLY for a successful response whose list is present and empty', () => {
        const state = resolveListState(
            makeQuery({ data: { providerMandates: { items: [], total: 0 } } }),
            selectMandates,
        );
        expect(state.status).toBe('empty');
    });

    it('reports ready rows with the payload total', () => {
        const state = resolveListState(
            makeQuery({ data: { providerMandates: { items: ROWS, total: 42 } } }),
            selectMandates,
        );

        expect(state.status).toBe('ready');
        if (state.status !== 'ready') {
            throw new Error('expected a ready state');
        }
        expect(state.items).toHaveLength(2);
        expect(state.total).toBe(42);
    });

    it('falls back to the item count when the payload carries no usable total', () => {
        const state = resolveListState(
            makeQuery({ data: { providerMandates: { items: ROWS } } }),
            selectMandates,
        );
        expect(state.status === 'ready' && state.total).toBe(ROWS.length);
    });

    it('accepts a bare-array payload (organizationSubscriptions) and still distinguishes empty', () => {
        const subsData: { organizationSubscriptions: Mandate[] } = { organizationSubscriptions: ROWS };
        const ready = resolveListState(
            makeQuery({ data: subsData }),
            value => value.organizationSubscriptions,
        );
        expect(ready.status === 'ready' && ready.total).toBe(ROWS.length);

        const emptyData: { organizationSubscriptions: Mandate[] } = { organizationSubscriptions: [] };
        const empty = resolveListState(
            makeQuery({ data: emptyData }),
            value => value.organizationSubscriptions,
        );
        expect(empty.status).toBe('empty');
    });

    it('lets `blocked` outrank every other signal, including an error', () => {
        // No channel selected: the query is not applicable. An idle query reports
        // isLoading === false, so this branch is what keeps "select a channel"
        // from being rendered as "no rows".
        const blocked = resolveListState(
            makeQuery<MandatesData>({ isError: true, error: new Error('should not surface') }),
            selectMandates,
            { blocked: true },
        );
        expect(blocked.status).toBe('blocked');
    });

    it('turns a throwing selector into an error state, not an empty list', () => {
        const state = resolveListState(
            makeQuery({ data: { providerMandates: { items: ROWS } } }),
            () => {
                throw new TypeError('cannot read properties of undefined');
            },
        );
        expect(state.status).toBe('error');
    });

    it('omits the retry action when the query exposes no refetch', () => {
        const state = resolveListState(
            makeQuery<MandatesData>({ isError: true, error: new Error('boom') }),
            selectMandates,
        );
        expect(state.status === 'error' && state.retry).toBeUndefined();
    });

    it('never maps any combination of loading / error / absent data to empty', () => {
        const combinations: Array<Partial<LedgerQueryLike<MandatesData>>> = [
            { isLoading: true },
            { isLoading: true, isError: true, error: new Error('boom') },
            {},
            { data: undefined },
            { isError: true, error: new Error('boom') },
            { isError: true, error: null },
            { isError: true, data: { providerMandates: { items: [], total: 0 } } },
            { data: {} as MandatesData },
            { data: { providerMandates: null } },
        ];

        for (const combination of combinations) {
            const state = resolveListState(makeQuery(combination), selectMandates);
            expect(
                state.status,
                `combination ${JSON.stringify(combination)} must not read as empty`,
            ).not.toBe('empty');
        }
    });

    it('describeQueryError reads only messages and never stringifies a whole object', () => {
        expect(describeQueryError(new Error('plain failure'))).toBe('plain failure');
        expect(describeQueryError('string failure')).toBe('string failure');
        expect(describeQueryError([{ message: 'first' }, { message: 'second' }])).toBe('first; second');
        expect(describeQueryError({ secret: 'provider_payload', message: 'safe message' })).toBe('safe message');
        expect(describeQueryError({ secret: 'provider_payload' })).toBe('The Billing API request failed.');
        expect(describeQueryError(undefined)).toBe('The Billing API request failed.');
    });
});

function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('B. Filter vocabularies come from the code that writes them (INV-015)', () => {
    it('offers exactly the attempt statuses the entity can hold', () => {
        const entity = readSource(
            'src/plugins/subscription/entities/subscription-billing-attempt.entity.ts',
        );
        const union = /export type BillingAttemptStatus\s*=\s*([^;]+);/.exec(entity);
        expect(union, 'BillingAttemptStatus union not found').not.toBeNull();

        const declared = Array.from(union![1].matchAll(/'([a-z_]+)'/g))
            .map(match => match[1])
            .sort();

        expect(declared.length).toBeGreaterThan(0);
        expect([...BILLING_ATTEMPT_STATUSES].sort()).toEqual(declared);
    });

    it('offers exactly the provider statuses the binding lifecycle can persist', () => {
        const processor = readSource(
            'src/plugins/subscription/providers/razorpay/razorpay-webhook.processor.ts',
        );

        const written = Array.from(
            processor.matchAll(
                /updateBinding\(ctx,\s*ne\.providerSubscriptionId,\s*'razorpay',\s*'([a-z_]+)'/g,
            ),
        ).map(match => match[1]);

        // Guard: a renamed helper would otherwise make this assertion vacuous.
        expect(written.length).toBeGreaterThanOrEqual(4);

        for (const status of new Set(written)) {
            expect(
                PROVIDER_SUBSCRIPTION_STATUSES as readonly string[],
                `provider status '${status}' is written by the processor and must be selectable`,
            ).toContain(status);
        }

        // Checkout persists the provider's own subscribe-response status, which is
        // `created` before the customer authorizes.
        expect(PROVIDER_SUBSCRIPTION_STATUSES as readonly string[]).toContain('created');

        // Ratchet: the option list is the reviewed, reachable set. Provider-only
        // terminal states with no writer would always return an empty table.
        expect([...PROVIDER_SUBSCRIPTION_STATUSES]).toEqual([
            'created',
            'authenticated',
            'active',
            'pending',
            'halted',
            'cancelled',
        ]);
    });

    it('matches the ReconciliationIncidentStatus enum declared in the Admin schema', () => {
        const schema = readSource('src/plugins/subscription/api/schema/subscription-admin.schema.ts');
        const block = /enum ReconciliationIncidentStatus\s*{([^}]*)}/.exec(schema);
        expect(block, 'ReconciliationIncidentStatus enum not found').not.toBeNull();

        const declared = block![1]
            .split(/\s+/)
            .map(token => token.trim())
            .filter(Boolean)
            .sort();

        expect([...RECONCILIATION_INCIDENT_STATUSES].sort()).toEqual(declared);
    });

    it('humanizes status tokens without inventing labels', () => {
        expect(humanizeStatus('past_due')).toBe('Past due');
        expect(humanizeStatus('active')).toBe('Active');
        expect(humanizeStatus('PENDING'.toLowerCase())).toBe('Pending');
    });
});

/**
 * Screens that still read `…items ?? []` with no error branch at all: if their
 * query fails, they render their empty state. They predate this check and are
 * tracked as a SHRINK-ONLY baseline — migrate a screen to `resolveListState`
 * and delete its entry here.
 */
const LEGACY_UNGUARDED_EMPTY_STATE = new Set<string>([
    'src/plugins/bigbluebutton-plugin/dashboard/routes/enrollments/EnrollmentsList.tsx',
    'src/plugins/bigbluebutton-plugin/dashboard/routes/entitlements/EntitlementsList.tsx',
    'src/plugins/bigbluebutton-plugin/dashboard/routes/members/MembersList.tsx',
    'src/plugins/bigbluebutton-plugin/dashboard/routes/memberships/MembershipsList.tsx',
    'src/plugins/bigbluebutton-plugin/dashboard/routes/plans/PlansList.tsx',
    'src/plugins/bigbluebutton-plugin/dashboard/routes/trials/TrialRegistrationsList.tsx',
    'src/plugins/reviews/dashboard/review-list.tsx',
    'src/plugins/tenant-plugin/dashboard/routes/instructors/InstructorsList.tsx',
    'src/plugins/tenant-plugin/dashboard/routes/media/MediaResourcesList.tsx',
]);

/** `data?.someList?.items ?? []` — the fallback that erases a rejection. */
const UNGUARDED_FALLBACK = /items\s*\?\?\s*\[\]/;

function unguardedEmptyStateFiles(files: string[]): string[] {
    return files.filter(file => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        return UNGUARDED_FALLBACK.test(source) && !source.includes('isError');
    });
}

describe('C. Structural ratchet: no list screen may hide a failure as an empty state', () => {
    it('finds the Dashboard sources to scan (guards against a silently empty scan)', () => {
        const files = dashboardFiles();
        expect(files.length).toBeGreaterThan(40);
        for (const screen of BILLING_SCREENS) {
            expect(files).toContain(screen);
        }
    });

    it('adds no new unguarded empty state', () => {
        const offenders = unguardedEmptyStateFiles(dashboardFiles()).filter(
            file => !LEGACY_UNGUARDED_EMPTY_STATE.has(file),
        );

        expect(
            offenders,
            'These screens can render a failed query as "no rows". Route them through ' +
                'resolveListState/LedgerStateView (INV-015) instead of `items ?? []`.',
        ).toEqual([]);
    });

    it('keeps the baseline shrink-only', () => {
        const stillViolating = new Set(unguardedEmptyStateFiles(dashboardFiles()));
        const stale = Array.from(LEGACY_UNGUARDED_EMPTY_STATE).filter(file => !stillViolating.has(file));

        expect(
            stale,
            'These files no longer render an unguarded empty state — remove them from ' +
                'LEGACY_UNGUARDED_EMPTY_STATE so the baseline keeps shrinking.',
        ).toEqual([]);
    });

    it('never baselines a billing ledger screen', () => {
        for (const screen of BILLING_SCREENS) {
            expect(
                LEGACY_UNGUARDED_EMPTY_STATE.has(screen),
                `${screen} must stay migrated, not baselined`,
            ).toBe(false);
        }
    });

    it('gates every billing ledger screen through the shared state resolver', () => {
        for (const screen of BILLING_SCREENS) {
            const source = readSource(screen);

            expect(source, `${screen} must resolve its state via resolveListState`).toContain(
                'resolveListState(',
            );
            expect(source, `${screen} must render through LedgerStateView`).toContain(
                'LedgerStateView',
            );
            expect(
                UNGUARDED_FALLBACK.test(source),
                `${screen} must not fall back to "items ?? []"`,
            ).toBe(false);
        }
    });

    it('renders the channel-scoped ledger screens as channel-gated', () => {
        // INV-001: the ledger query must be disabled without a channel, and that
        // state must be reported as `blocked` rather than as zero rows.
        for (const screen of BILLING_SCREENS.slice(1)) {
            const source = readSource(screen);
            expect(source, `${screen} must mark the ledger blocked without a channel`).toContain(
                'blocked:',
            );
            expect(source, `${screen} must derive the active channel`).toContain('activeChannelId');
        }
    });
});

