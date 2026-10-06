/**
 * Dashboard tsc error-count ratchet (SHRINK-ONLY).
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * `npx tsc -p tsconfig.dashboard.json --noEmit` currently reports a
 * documented, pre-existing set of errors: node_modules .d.ts clashes
 * (ts-morph / @ts-morph/common / @tanstack / @dnd-kit), the marketplace and
 * CMS screens, the generated src/gql/graphql-env.d.ts TS2717, and BBB
 * TS6307 cross-project imports (QUERY-STATE REPORT below). The gate is a
 * ratchet: both the per-file counts and the total may SHRINK, never grow.
 * A single new error in any file — including a file absent from this
 * baseline — fails.
 *
 * Baseline captured 2026-10-05: 119 errors across 39 files.
 * SHRUNK 2026-10-06: 118 — DashboardOverview.tsx's TS6307 (import of the
 * root-owned `shared/format`) is cleared by the dashboard-local copy bound
 * to the canonical by a parity spec (`dashboard/lib/format.ts` +
 * `__tests__/format-paise-inr-parity.spec.ts`).
 *
 * QUERY-STATE REPORT (remaining TS6307 — tracked; the format fix above is
 * the template for closing it):
 *   - routes/rooms/RoomDetail.tsx (1) — TS6307: imports
 *     `src/platform/dashboard/query-state` (INV-015 resolveListState), a
 *     root-project file, from the composite dashboard project.
 *     Attribution: tsc emits TS6307 ONCE PER out-of-project target at the
 *     first importer it visits — the other 7 dashboard importers of
 *     query-state (BBB TrialRegistrationsList, PeopleList; subscription
 *     query-state-panel + 4 list screens) are NOT charged, and neither are
 *     the other importers of `shared/format` (only DashboardOverview was).
 *     Sibling case: subscription's `platform/dashboard/billing-vocabularies`
 *     is charged once to MandatesList (1).
 *     Root cause is shared: the file is a ROOT-program file while the
 *     dashboard project is a referenced COMPOSITE (root tsconfig
 *     `references`), so widening `include` is TS6305 (a file cannot be a
 *     root file of both projects — verified, see known-bugs.md).
 *     Fix path = the format pattern (dashboard-owned copy + root-side
 *     parity/dynamic-import spec); not taken yet: query-state is 211 lines
 *     shared by 8 screens across 2 plugins.
 *
 * SHRINKING: when you fix errors, lower the counts here (and TOTAL_BASELINE).
 * Never raise them. The total must stay equal to the sum of FILE_BASELINE.
 *
 * Run:
 *   npx vitest run --config vitest.config.mts \
 *     src/plugins/subscription/__tests__/dashboard-tsc-ratchet.spec.ts
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';

/** Repository root: src/plugins/subscription/__tests__ → up four levels. */
const ROOT = path.resolve(__dirname, '../../../..');

/** Total allowed error count — shrink-only. Must equal the sum of the map. */
const TOTAL_BASELINE = 118;

/** Per-file allowed error counts — shrink-only. Repo-relative paths. */
const FILE_BASELINE_A: Record<string, number> = {
    "node_modules/@dnd-kit/core/dist/components/Accessibility/Accessibility.d.ts": 1,
    "node_modules/@dnd-kit/core/dist/components/DragOverlay/components/AnimationManager/AnimationManager.d.ts": 1,
    "node_modules/@dnd-kit/core/dist/components/DragOverlay/components/NullifiedContextProvider/NullifiedContextProvider.d.ts": 1,
    "node_modules/@dnd-kit/core/dist/components/DragOverlay/components/PositionedOverlay/PositionedOverlay.d.ts": 1,
    "node_modules/@dnd-kit/core/dist/components/DragOverlay/DragOverlay.d.ts": 2,
    "node_modules/@dnd-kit/sortable/dist/components/SortableContext.d.ts": 1,
    "node_modules/@tanstack/query-core/build/modern/_tsup-dts-rollup.d.ts": 12,
    "node_modules/@tanstack/router-core/dist/esm/ssr/types.d.ts": 1,
    "node_modules/@ts-morph/common/lib/ts-morph-common.d.ts": 14,
    "node_modules/ts-morph/lib/ts-morph.d.ts": 31,
    "node_modules/@vendure/dashboard/src/lib/components/data-input/relation-selector.tsx": 1,
    "node_modules/@vendure/dashboard/src/lib/components/layout/language-dialog.tsx": 1,
    "node_modules/@vendure/dashboard/src/lib/components/shared/assigned-facet-values.tsx": 1,
    "node_modules/@vendure/dashboard/src/lib/components/shared/detail-page-button.tsx": 1,
    "node_modules/@vendure/dashboard/src/lib/components/shared/entity-assets.tsx": 1,
    "node_modules/@vendure/dashboard/src/lib/components/shared/powered-by-vendure.tsx": 1,
    "node_modules/@vendure/dashboard/src/lib/framework/dashboard-widget/metrics-widget/index.tsx": 1,
    "node_modules/@vendure/dashboard/src/lib/framework/data-table/data-table-extensions.ts": 1,
    "node_modules/@vendure/dashboard/src/lib/framework/document-introspection/get-document-structure.ts": 1,
};

const FILE_BASELINE_B: Record<string, number> = {
    "node_modules/@vendure/dashboard/src/lib/framework/document-introspection/include-only-selected-list-fields.ts": 6,
    "node_modules/@vendure/dashboard/src/lib/framework/extension-api/custom-providers.ts": 1,
    "node_modules/@vendure/dashboard/src/lib/framework/extension-api/define-dashboard-extension.ts": 2,
    "node_modules/@vendure/dashboard/src/lib/framework/extension-api/use-dashboard-extensions.ts": 1,
    "node_modules/@vendure/dashboard/src/lib/framework/page/detail-page.tsx": 1,
    "node_modules/@vendure/dashboard/src/lib/framework/page/use-extended-router.tsx": 2,
    "node_modules/@vendure/dashboard/src/lib/graphql/api.ts": 1,
    "node_modules/@vendure/dashboard/src/lib/graphql/schema-enums.ts": 1,
    "node_modules/@vendure/dashboard/src/lib/index.ts": 1,
    "node_modules/@vendure/dashboard/src/lib/lib/load-i18n-messages.ts": 1,
    "node_modules/@vendure/dashboard/src/lib/utils/config-utils.ts": 1,
    "src/gql/graphql-env.d.ts": 1,
    "src/plugins/bigbluebutton-plugin/dashboard/routes/rooms/RoomDetail.tsx": 1,
    "src/plugins/cms/dashboard/article-detail.tsx": 2,
    "src/plugins/cms/dashboard/banner-detail.tsx": 2,
    "src/plugins/cms/dashboard/page-detail.tsx": 2,
    "src/plugins/marketplace/dashboard/campaign-detail.tsx": 9,
    "src/plugins/marketplace/dashboard/campaign-list.tsx": 8,
    "src/plugins/subscription/dashboard/routes/mandates/MandatesList.tsx": 1,
};

const FILE_BASELINE: Record<string, number> = { ...FILE_BASELINE_A, ...FILE_BASELINE_B };

/** Run the dashboard project's tsc and count errors per file (repo-relative). */
function collectDashboardTscErrors(): { counts: Map<string, number>; spawnFailed?: string } {
    const tscJs = path.join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js');
    const result = spawnSync(
        process.execPath,
        [tscJs, '-p', 'tsconfig.dashboard.json', '--noEmit', '--pretty', 'false'],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.error) {
        return { counts: new Map(), spawnFailed: result.error.message };
    }
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const counts = new Map<string, number>();
    const re = /^(.+?)\(\d+,\d+\): error TS\d+/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(output)) !== null) {
        const file = match[1];
        counts.set(file, (counts.get(file) ?? 0) + 1);
    }
    // tsc exits 0 (clean), 1 or 2 (diagnostics). Anything else with zero
    // parsed diagnostics means tsc itself failed — never treat that as green.
    if (counts.size === 0 && ![0, 1, 2].includes(result.status ?? -1)) {
        return { counts, spawnFailed: `tsc exited with status ${result.status}` };
    }
    return { counts };
}

function formatGrouping(counts: Map<string, number>): string {
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([file, n]) => `  ${String(n).padStart(3)}  ${file}`)
        .join('\n');
}

describe('dashboard tsc error-count ratchet (shrink-only)', () => {
    it('never exceeds the baselined per-file or total error counts', () => {
        const { counts, spawnFailed } = collectDashboardTscErrors();
        expect(spawnFailed, `tsc failed to run: ${spawnFailed}`).toBeUndefined();

        const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
        const grouping = formatGrouping(counts);

        // 1) Per-file: a file absent from the baseline may have ZERO errors;
        //    a baselined file may only shrink.
        const grown = [...counts.entries()].filter(
            ([file, n]) => n > (FILE_BASELINE[file] ?? 0),
        );
        // 2) Total: shrink-only net check.
        expect(
            total,
            `Dashboard tsc error total grew (baseline ${TOTAL_BASELINE}, now ${total}). ` +
                `Errors by file:\n${grouping}`,
        ).toBeLessThanOrEqual(TOTAL_BASELINE);

        expect(
            grown,
            `Per-file dashboard tsc error counts grew (shrink-only ratchet). ` +
                `Grown/new files:\n${grown.map(([f, n]) => `  ${f}: ${n} > ${FILE_BASELINE[f] ?? 0}`).join('\n')}\n` +
                `Full grouping:\n${grouping}`,
        ).toEqual([]);

        // Shrink observed → remind the maintainer to ratchet the baseline down.
        if (total < TOTAL_BASELINE) {
            console.info(
                `[ratchet] shrink observed: ${total} < ${TOTAL_BASELINE}. ` +
                    `Lower TOTAL_BASELINE and the affected FILE_BASELINE entries.`,
            );
        }
    }, 300_000);
});
