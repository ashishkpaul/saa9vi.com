/**
 * Format integer **paise** as an Indian-rupee currency string (ADR-047 /
 * integer-paise rule: money crosses every boundary as integer paise and is
 * formatted only at the presentation edge).
 *
 * ROOT-CANONICAL copy. Lives OUTSIDE `dashboard/` because the dashboard
 * folder is a separate tsconfig project (`tsconfig.dashboard.json`,
 * composite, referenced by the root) and unit specs under the root project
 * cannot import across that boundary (TS6305). Dashboard screens use the
 * dashboard-local copy at `dashboard/lib/format.ts` (importing this file
 * from them is TS6307); the two implementations are kept byte-identical by
 * `__tests__/format-paise-inr-parity.spec.ts`, which dynamic-imports the
 * dashboard copy and diffs its output against this one.
 *
 * `formatPaiseInr(2000)` → `"₹20.00"`; `formatPaiseInr(10_000_000)` →
 * `"₹1,00,000.00"` (lakh grouping via `en-IN`).
 *
 * Non-finite / non-number input renders `"₹0.00"` — a malformed value must
 * never look like a price.
 */
export function formatPaiseInr(paise: number | null | undefined): string {
  if (typeof paise !== "number" || !Number.isFinite(paise)) {
    return "₹0.00";
  }
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}