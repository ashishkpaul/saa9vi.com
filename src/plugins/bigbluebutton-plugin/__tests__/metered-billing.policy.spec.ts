/**
 * ADR-047 / INV-028 — metered-billing policy (rate resolution).
 *
 * Infrastructure-free by design (no Postgres, Redis or BBB): the policy module is
 * pure, so the rate-resolution semantics can be pinned exactly. Phase 2 of
 * `docs/implementation/bbb-attendee-hour-billing-plan.md` extends BOTH the policy
 * module and this spec with the learner math and the single monthly rounding
 * implementation (`computeMonthChargePaise`) — this file already covers the parts
 * that Phase 1 ships, so a regression in rate resolution fails here rather than in
 * a customer's invoice.
 *
 * Why these cases matter (ADR-047 decision 3 / §6 trade-offs):
 *   • The rate is snapshotted per meeting, so a wrong resolution is permanently
 *     wrong for that usage row.
 *   • `ratePaisePerLearnerHour = 0` is a legitimate configuration ("this tenant is
 *     not charged") and MUST NOT be replaced by the platform default — hence the
 *     explicit-0 case below.
 *   • A malformed rate must never silently become a price: invalid values are
 *     ignored and fall through, and an unconfigured rate bills 0.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR } from "../constants";
import {
  computeMonthChargePaise,
  isApproachingSpendLimit,
  isMeteredOrganization,
  learnerCountFrom,
  monthOf,
  platformDefaultRatePaisePerHour,
  resolveRatePaisePerLearnerHour,
  SPEND_LIMIT_APPROACH_PCT,
} from "../services/metered-billing.policy";

describe("resolveRatePaisePerLearnerHour", () => {
  it("prefers the organization override over the platform default", () => {
    expect(
      resolveRatePaisePerLearnerHour(
        { ratePaisePerLearnerHour: 45_000 },
        12_000,
      ),
    ).toBe(45_000);
  });

  it("falls back to the platform default when the org has no rate", () => {
    expect(resolveRatePaisePerLearnerHour({ ratePaisePerLearnerHour: null }, 12_000)).toBe(12_000);
    expect(resolveRatePaisePerLearnerHour({}, 12_000)).toBe(12_000);
    expect(resolveRatePaisePerLearnerHour(null, 12_000)).toBe(12_000);
    expect(resolveRatePaisePerLearnerHour(undefined, 12_000)).toBe(12_000);
  });

  it("treats an explicit org rate of 0 as configured (never falls through)", () => {
    expect(resolveRatePaisePerLearnerHour({ ratePaisePerLearnerHour: 0 }, 12_000)).toBe(0);
  });

  it("bills 0 when nothing is configured, rather than inventing a price", () => {
    expect(resolveRatePaisePerLearnerHour({ ratePaisePerLearnerHour: null }, null)).toBe(0);
    expect(resolveRatePaisePerLearnerHour(null, undefined)).toBe(0);
    expect(resolveRatePaisePerLearnerHour(undefined, undefined)).toBe(0);
  });

  it("ignores malformed org rates and falls through to a valid default", () => {
    const malformed: Array<number> = [-1, 12.5, Number.NaN, Number.POSITIVE_INFINITY];
    for (const rate of malformed) {
      expect(resolveRatePaisePerLearnerHour({ ratePaisePerLearnerHour: rate }, 12_000)).toBe(
        12_000,
      );
    }
  });

  it("ignores a malformed platform default too (never a negative or fractional price)", () => {
    expect(resolveRatePaisePerLearnerHour({}, -500)).toBe(0);
    expect(resolveRatePaisePerLearnerHour({}, 9.99)).toBe(0);
    expect(resolveRatePaisePerLearnerHour({}, Number.NaN)).toBe(0);
  });
});

describe("isMeteredOrganization", () => {
  it("is true only for billingMode === 'metered'", () => {
    expect(isMeteredOrganization({ billingMode: "metered" })).toBe(true);
  });

  it("is false for grant orgs, missing rows and missing modes", () => {
    expect(isMeteredOrganization({ billingMode: "grant" })).toBe(false);
    expect(isMeteredOrganization({})).toBe(false);
    expect(isMeteredOrganization(null)).toBe(false);
    expect(isMeteredOrganization(undefined)).toBe(false);
  });
});

describe("learnerCountFrom", () => {
  it("excludes moderators from the billable count", () => {
    expect(learnerCountFrom(42, 2)).toBe(40);
    expect(learnerCountFrom(5, 0)).toBe(5);
  });

  it("bills two trainers + N students as N only (D1/D9)", () => {
    expect(learnerCountFrom(7, 2)).toBe(5);
    expect(learnerCountFrom(2, 2)).toBe(0);
  });

  it("never bills negative — moderator-heavy instants bill zero", () => {
    expect(learnerCountFrom(1, 3)).toBe(0);
    expect(learnerCountFrom(0, 0)).toBe(0);
  });

  it("treats missing or malformed counts as no observation (0)", () => {
    expect(learnerCountFrom(null, 1)).toBe(0);
    expect(learnerCountFrom(4, undefined)).toBe(4);
    expect(learnerCountFrom(undefined, undefined)).toBe(0);
    expect(learnerCountFrom(-2, 1)).toBe(0);
    expect(learnerCountFrom(3.5, 1)).toBe(0);
    expect(learnerCountFrom(4, Number.NaN)).toBe(4);
    expect(learnerCountFrom(Number.POSITIVE_INFINITY, 0)).toBe(0);
  });
});

describe("monthOf", () => {
  it("snapshots the IST month as YYYY-MM with zero padding", () => {
    expect(monthOf(new Date(Date.UTC(2026, 8, 30, 12, 0, 0)))).toBe("2026-09");
    expect(monthOf(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe("2026-01");
  });

  it("books 18:30 UTC to the NEXT IST day (00:00 IST is the boundary)", () => {
    // 2026-09-30T18:30:00Z == 2026-10-01T00:00:00+05:30 → October in IST.
    expect(monthOf(new Date("2026-09-30T18:30:00.000Z"))).toBe("2026-10");
  });

  it("books 18:29 UTC to the SAME IST day (one minute before midnight IST)", () => {
    // 2026-09-30T18:29:00Z == 2026-09-30T23:59:00+05:30 → September in IST.
    expect(monthOf(new Date("2026-09-30T18:29:00.000Z"))).toBe("2026-09");
  });

  it("uses IST — the same instant never lands in two months", () => {
    // 2026-09-30T19:00:00-04:00 == 2026-10-01T00:30:00+05:30 → October in IST.
    expect(monthOf(new Date("2026-09-30T19:00:00-04:00"))).toBe("2026-10");
    // 2026-10-01T00:30:00+05:30 == 2026-09-30T19:00:00Z → October in IST.
    expect(monthOf(new Date("2026-10-01T00:30:00+05:30"))).toBe("2026-10");
  });

  it("pins periodMonth boundaries (D4) in IST", () => {
    // 2026-09-30T18:29:59Z == 23:59:59 IST Sep 30 → September.
    expect(monthOf(new Date(Date.UTC(2026, 8, 30, 18, 29, 59)))).toBe("2026-09");
    // 2026-09-30T18:30:00Z == 00:00:00 IST Oct 1 → October.
    expect(monthOf(new Date(Date.UTC(2026, 8, 30, 18, 30, 0)))).toBe("2026-10");
  });

  it("throws on an invalid date instead of inventing a month key", () => {
    expect(() => monthOf(new Date(Number.NaN))).toThrow(/valid Date/);
  });
});

describe("computeMonthChargePaise", () => {
  it("charges 0 for missing or empty input", () => {
    expect(computeMonthChargePaise(null)).toBe(0);
    expect(computeMonthChargePaise(undefined)).toBe(0);
    expect(computeMonthChargePaise([])).toBe(0);
  });

  it("charges 0 minutes as 0 paise (zero-learner meetings still write a row)", () => {
    expect(
      computeMonthChargePaise([{ learnerMinutes: 0, ratePaisePerHour: 12_000 }]),
    ).toBe(0);
  });

  it("rounds exactly one minute at ₹120/hr up to 200 paise (no zero-rounding)", () => {
    // 1 × 12000 / 60 = 200 exactly.
    expect(
      computeMonthChargePaise([{ learnerMinutes: 1, ratePaisePerHour: 12_000 }]),
    ).toBe(200);
  });

  it("rounds 61 learner-minutes at ₹120/hr to a single money value", () => {
    // 61 × 12000 / 60 = 12200 exactly.
    expect(
      computeMonthChargePaise([{ learnerMinutes: 61, ratePaisePerHour: 12_000 }]),
    ).toBe(12_200);
  });

  it("rounds once for the month — never per meeting (D2)", () => {
    // 1 min @ 15 paise/hr × 2 rows → monthly round(30 / 60) = round(0.5) = 1,
    // but a per-meeting sum would give round(0.25) + round(0.25) = 0 + 0 = 0.
    // The monthly rule bills 1 — this pins the formula against a future
    // per-row rounding regression.
    expect(
      computeMonthChargePaise([
        { learnerMinutes: 1, ratePaisePerHour: 15 },
        { learnerMinutes: 1, ratePaisePerHour: 15 },
      ]),
    ).toBe(1);
    // Sanity: 1 min @ 45/hr × 2 → monthly round(90 / 60) = round(1.5) = 2.
    expect(
      computeMonthChargePaise([
        { learnerMinutes: 1, ratePaisePerHour: 45 },
        { learnerMinutes: 1, ratePaisePerHour: 45 },
      ]),
    ).toBe(2);
  });

  it("mixes rates within one month through the same single total", () => {
    // (30 × 12000 + 45 × 6000) / 60 = (360000 + 270000) / 60 = 10500.
    expect(
      computeMonthChargePaise([
        { learnerMinutes: 30, ratePaisePerHour: 12_000 },
        { learnerMinutes: 45, ratePaisePerHour: 6_000 },
      ]),
    ).toBe(10_500);
  });

  it("ignores malformed rows instead of coercing them into a price", () => {
    expect(
      computeMonthChargePaise([
        { learnerMinutes: 30, ratePaisePerHour: 12_000 },
        null,
        undefined,
        { learnerMinutes: -5, ratePaisePerHour: 12_000 },
        { learnerMinutes: 10, ratePaisePerHour: Number.NaN },
        { learnerMinutes: 2.5, ratePaisePerHour: 12_000 },
      ]),
    ).toBe(6_000);
  });
});

describe("half-up rounding to the paisa (Q2)", () => {
  it("rounds an exact .5 paisa UP — 1.5 → 2, 0.5 → 1 (never banker's rounding)", () => {
    // 1 min × 90 paise/hr / 60 = 1.5 → 2.
    expect(
      computeMonthChargePaise([{ learnerMinutes: 1, ratePaisePerHour: 90 }]),
    ).toBe(2);
    // 3 min × 10 paise/hr / 60 = 0.5 → 1.
    expect(
      computeMonthChargePaise([{ learnerMinutes: 3, ratePaisePerHour: 10 }]),
    ).toBe(1);
  });

  it("rounds the monthly total's exact .5 UP once, after the sum (D2)", () => {
    // (90 × 2000 + 1 × 90) / 60 = 180090 / 60 = 3001.5 → 3002.
    expect(
      computeMonthChargePaise([
        { learnerMinutes: 90, ratePaisePerHour: 2000 },
        { learnerMinutes: 1, ratePaisePerHour: 90 },
      ]),
    ).toBe(3002);
  });
});

describe("platformDefaultRatePaisePerHour (Q2 placeholder)", () => {
  it("falls back to the clearly marked placeholder when the option is omitted", () => {
    expect(platformDefaultRatePaisePerHour(undefined)).toBe(
      DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR,
    );
    expect(platformDefaultRatePaisePerHour(null)).toBe(
      DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR,
    );
    expect(platformDefaultRatePaisePerHour({})).toBe(
      DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR,
    );
  });

  it("honours an explicit option — including 0 (configured: bill nothing)", () => {
    expect(
      platformDefaultRatePaisePerHour({ defaultRatePaisePerLearnerHour: 0 }),
    ).toBe(0);
    expect(
      platformDefaultRatePaisePerHour({ defaultRatePaisePerLearnerHour: 4500 }),
    ).toBe(4500);
  });

  it("treats a malformed option as unconfigured (never a negative/fractional price)", () => {
    expect(
      platformDefaultRatePaisePerHour({ defaultRatePaisePerLearnerHour: -1 }),
    ).toBe(DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR);
    expect(
      platformDefaultRatePaisePerHour({ defaultRatePaisePerLearnerHour: 12.5 }),
    ).toBe(DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR);
  });
});

/**
 * ADR-047 decision 12 (production-readiness item 4) — the compensating control
 * for a SOFT monthly spend ceiling. The cap itself stays an unlocked read; this
 * predicate decides when the compensating operator alert fires. It must be
 * exactly the "approaching but not yet at" band, because at/over the limit is
 * the refusal path (a different signal), and a threshold that fires at 100%
 * would alert only at the moment provisioning is already being refused.
 */
describe("isApproachingSpendLimit (soft ceiling compensating control, D12)", () => {
  it("pins the threshold at 90%", () => {
    expect(SPEND_LIMIT_APPROACH_PCT).toBe(90);
  });

  it("is false below the threshold and true at or above it", () => {
    expect(isApproachingSpendLimit(89_999, 100_000)).toBe(false);
    expect(isApproachingSpendLimit(90_000, 100_000)).toBe(true); // exactly 90%
    expect(isApproachingSpendLimit(90_001, 100_000)).toBe(true);
  });

  it("is false once the limit is reached — at/over is the refusal gate, not the approach", () => {
    expect(isApproachingSpendLimit(100_000, 100_000)).toBe(false);
    expect(isApproachingSpendLimit(150_000, 100_000)).toBe(false);
  });

  it("is false when no limit is configured (unmetered/uncapped)", () => {
    expect(isApproachingSpendLimit(90_000, null)).toBe(false);
    expect(isApproachingSpendLimit(90_000, undefined)).toBe(false);
  });

  it("is false for malformed or nonsensical inputs (never alert on bad math)", () => {
    expect(isApproachingSpendLimit(90_000, 0)).toBe(false);
    expect(isApproachingSpendLimit(90_000, -100_000)).toBe(false);
    expect(isApproachingSpendLimit(90_000, 12.5)).toBe(false);
    expect(isApproachingSpendLimit(-1, 100_000)).toBe(false);
    expect(isApproachingSpendLimit(Number.NaN, 100_000)).toBe(false);
    expect(isApproachingSpendLimit(90_000.5, 100_000)).toBe(false);
  });

  it("uses integer cross-multiplication — no float drift at the boundary", () => {
    // charge × 100 vs limit × 90: with a limit of 3 paise, 3 × 90 = 270, so a
    // charge of 3 is *at* the limit (gate) and 2 (200 < 270) is not "approaching".
    // A naive `charge / limit >= 0.9` float compare would be the only other
    // implementation; this pins the exact-integer semantics.
    expect(isApproachingSpendLimit(2, 3)).toBe(false);
    expect(isApproachingSpendLimit(10, 10)).toBe(false);
    expect(isApproachingSpendLimit(9, 10)).toBe(true);
  });
});
