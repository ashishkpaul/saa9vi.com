import { describe, expect, it } from "vitest";
import path from "path";
import { formatPaiseInr as canonical } from "../shared/format";

/**
 * The dashboard project is a referenced COMPOSITE project (root tsconfig
 * `references`), so a STATIC import of a dashboard-owned file from the root
 * program is TS6305/TS6307. A dynamic import with a runtime-built specifier
 * is not resolved by tsc, but vitest resolves it fine — that is the only
 * channel across the project boundary, and it lets this root-side spec call
 * the dashboard-local implementation directly.
 */
async function loadDashboardFormat(): Promise<{
  formatPaiseInr: (paise: number | null | undefined) => string;
}> {
  const dashPath = path.resolve(__dirname, "../dashboard/lib/format.ts");
  return import(dashPath) as Promise<{
    formatPaiseInr: (paise: number | null | undefined) => string;
  }>;
}

describe("dashboard-local formatPaiseInr parity", () => {
  it("is byte-identical to the root canonical implementation across the vector table", async () => {
    const dash = await loadDashboardFormat();
    const vectors: (number | null | undefined)[] = [
      0,
      1,
      5,
      50,
      99,
      100,
      2000,
      123_456,
      12_340_000,
      10_000_000,
      100_000_000,
      100_000_000_00,
      -1,
      -2000,
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      "1234" as unknown as number,
      {} as unknown as number,
    ];
    for (const v of vectors) {
      expect(
        dash.formatPaiseInr(v),
        `mismatch for input ${String(v)}`,
      ).toBe(canonical(v));
    }
  });

  it("satisfies the pinned contract on BOTH sides (no shared-bug pass-through)", async () => {
    const dash = await loadDashboardFormat();
    for (const impl of [dash.formatPaiseInr, canonical]) {
      expect(impl(0)).toBe("₹0.00");
      expect(impl(2000)).toBe("₹20.00");
      expect(impl(12_340_000)).toBe("₹1,23,400.00");
      expect(impl(10_000_000)).toBe("₹1,00,000.00");
      expect(impl(null)).toBe("₹0.00");
      expect(impl(Number.NaN)).toBe("₹0.00");
    }
  });
});
