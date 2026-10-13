import { describe, expect, it } from "vitest";

import { formatPaiseInr } from "../shared/format";

describe("formatPaiseInr", () => {
  it("formats zero and whole rupees with two decimals", () => {
    expect(formatPaiseInr(0)).toBe("₹0.00");
    expect(formatPaiseInr(2000)).toBe("₹20.00");
    expect(formatPaiseInr(12_340_000)).toBe("₹1,23,400.00");
  });

  it("keeps sub-rupee precision (paise never disappear)", () => {
    expect(formatPaiseInr(50)).toBe("₹0.50");
    expect(formatPaiseInr(5)).toBe("₹0.05");
    expect(formatPaiseInr(123_456)).toBe("₹1,234.56");
  });

  it("uses Indian lakh grouping (en-IN)", () => {
    expect(formatPaiseInr(10_000_000)).toBe("₹1,00,000.00");
    expect(formatPaiseInr(100_000_000)).toBe("₹10,00,000.00");
  });

  it("renders malformed input as ₹0.00 — never a fabricated price", () => {
    expect(formatPaiseInr(null)).toBe("₹0.00");
    expect(formatPaiseInr(undefined)).toBe("₹0.00");
    expect(formatPaiseInr(Number.NaN)).toBe("₹0.00");
    expect(formatPaiseInr(Number.POSITIVE_INFINITY)).toBe("₹0.00");
  });
});