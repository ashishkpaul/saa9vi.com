/**
 * Format integer **paise** as an Indian-rupee currency string (ADR-047 /
 * integer-paise rule: money crosses every boundary as integer paise and is
 * formatted only at the presentation edge).
 *
 * Lives OUTSIDE `dashboard/` on purpose: the dashboard folder is a separate
 * tsconfig project (`tsconfig.dashboard.json`, referenced by the root), so
 * unit specs under the root project cannot import across that boundary
 * (TS6305). Dashboard screens import it as `../../shared/format` — vite
 * resolves it without any project-boundary concerns.
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