/**
 * Dashboard-local copy of `shared/format.ts` (`formatPaiseInr`).
 *
 * WHY A COPY (and not an import)
 * ------------------------------
 * `tsconfig.dashboard.json` is a separate COMPOSITE project referenced by the
 * root tsconfig (`references`), so importing a root-owned file into it is
 * TS6307 ("not listed within the file list of project"), and widening
 * `include` to swallow a root-owned file is TS6305 (a file cannot be a root
 * file of both projects — verified, see known-bugs.md). Dashboard screens
 * therefore keep their own copy INSIDE `dashboard/`.
 *
 * PARITY IS ENFORCED: `../../__tests__/format-paise-inr-parity.spec.ts`
 * (root project) dynamically imports this file and asserts byte-identical
 * output against `../../shared/format` across the full vector table — edit
 * ONE side only and the suite fails. Keep the implementations literally
 * identical to `shared/format.ts`.
 *
 * ADR-047 integer-paise rule: money crosses every boundary as integer paise
 * and is formatted only at the presentation edge.
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
