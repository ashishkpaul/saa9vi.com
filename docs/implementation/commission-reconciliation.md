# Commission Reconciliation Contract (Gate R1)

**Status:** Adopted (design gate — no code in this document)
**Scope:** Phase 3 — Commission reconciliation / admin reporting
**Authority:** ADR-021 (attribution + commission), INV-002 / DL-030 (ledger discipline)
**Implementation target:** R2 (read-only reporting) + R3 (E2E) — built strictly on top of this contract.

---

## 1. Purpose

`CommissionLedger` is complete and E2E-verified (6-case E2E; single-use arbitration; 0% rows).
What is missing is the **operational layer**: the ability to observe, from the ledger alone,
whether the commission fact population is complete and internally consistent — and to report
commission economics without recalculating them.

This contract defines what reconciliation **means** before any code exists.

---

## 2. The authority rule (non-negotiable)

> **`CommissionLedger` is the sole authoritative commission fact.**
> Reconciliation NEVER recalculates commission and NEVER writes to `CommissionLedger`.
> There is no second ledger, no reconciliation table acting as financial truth, and no
> reconstruction of commission from Orders.

Reconciliation is **read-only observation**:

```text
Orders (Postgres, authoritative commerce state)
        ↕  comparison only
CommissionLedger (immutable facts)
        ↓
discrepancy report (transient / API output — not a financial table)
```

Any future "repair" mechanism is out of scope for R1–R3 and would require its own ADR
(it would be the only sanctioned writer besides `CommissionListener`).

---

## 3. Definitions (grounded in the actual schema)

`commission_ledger` columns (migration-governed): `channelId`, `orderId` (UNIQUE),
`orderSource` ('marketplace' | 'referral' | 'direct'), `marketplaceRef` (UNIQUE, nullable),
`grossAmountInPaise`, `commissionPercent`, `commissionAmountInPaise`, `currency`.

### 3.1 Marketplace order (the comparison population)

An Order is **marketplace-classified** iff:

```text
Order.customFields.orderSource === 'marketplace'   (server-classified only; ADR-021 D5)
```

Client-supplied or absent classifications are never trusted. `orderSource = 'direct'`
or `'referral'` orders are **out of the expected-ledger population** (excluded from
MISSING accounting; see §4).

### 3.2 Expected ledger cardinality

Per ADR-021 + DL-030, for every marketplace-classified order, **exactly one** ledger row:

```text
E(order) = 1 row, with:
  row.orderId                  === order.id
  row.channelId                === order's primary channel id
  row.orderSource              === 'marketplace'
  row.marketplaceRef           !== null
  row.currency                 === order currency
  row.commissionAmountInPaise  === floor(gross * percent / 100)   (internal, see §4.3)
```

Direct/referral orders: expected cardinality **0**. A ledger row for a non-marketplace
order would itself be an anomaly (§4.4).

---

## 4. Discrepancy classes

The DB constraints (`UNIQUE(orderId)`, `UNIQUE(marketplaceRef)`) make duplicate ledger rows
for one order **physically impossible**. "Duplicate" therefore appears in reconciliation only
as the already-arbitrated replay outcome (§4.2), not as a row-level anomaly. The real classes:

### 4.1 MISSING — the only financially dangerous class

```text
Order.customFields.orderSource = 'marketplace'
AND no commission_ledger row with row.orderId = order.id
→ MISSING
```

Cause model: `CommissionLedgerService.recordMarketplaceOrder()` returned `'error'` after the
order was classified (the service already logs `RECONCILIATION-REQUIRED` for exactly this).
MISSING is the primary reconciliation deliverable.

### 4.2 REPLAYED_REF (informational, not an anomaly)

```text
Order classified 'direct' (or 'referral') whose customFields carried a marketplaceRef
that already exists in the ledger on a different orderId
→ REPLAYED_REF (ADR-021 Decision 6 worked as designed)
```

Counted and reported for audit visibility; never an error.

### 4.3 AMOUNT_MISMATCH — stored-row internal consistency only

```text
row.commissionAmountInPaise !== floor(row.grossAmountInPaise * row.commissionPercent / 100)
→ AMOUNT_MISMATCH
```

Rationale: `MARKETPLACE_COMMISSION_PERCENT` may change over time; rows written at the old
rate are historical truth, not anomalies. Cross-checking against the *current* env percent is
reported only as an informational `RATE_DRIFT` count — never an anomaly.

### 4.4 ORPHAN_LEDGER_ROW (defensive)

```text
Ledger row whose orderId does not resolve to an existing Order,
or resolves to an order whose orderSource ≠ 'marketplace'
→ ORPHAN_LEDGER_ROW
```

Expected to remain zero (the listener only writes post-classification); the check exists to
prove that rather than assume it.

### 4.5 ZERO_RATE rows

Rows with `commissionPercent = 0` (hence `commissionAmountInPaise = 0`) are **valid facts**,
never anomalies (DL-030 GMV-history requirement). They surface in reporting as a distinct
count and participate in MISSING/MISMATCH accounting identically to paid rows.

---

## 5. Reconciliation period & execution model

* **On-demand, read-only** — an Admin GraphQL query, not a second ScheduledTask.
* Optional `from`/`to` filter (order placement date); default = all time.
  **`from`/`to` is applied via `Order.orderPlacedAt`** (Vendure's indexed
  placement timestamp) — NEVER `CommissionLedger.createdAt` (ledger insertion
  time is a write-event fact, not a period boundary). Ledger financial values
  (`grossAmountInPaise`, `commissionPercent`, `commissionAmountInPaise`,
  `currency`) remain authoritative for all monetary aggregates regardless of
  the selected period.
* Channel-scoped by `RequestContext`: a channel admin reconciles only their channel;
  SuperAdmin may reconcile all (INV-002 tenant isolation).
* Single pass over marketplace orders + ledger join suffices at current volume. If volume
  ever demands it, a scheduled *reporting* task can wrap the same read-only service — no
  contract change.

---

## 6. Discrepancy handling

R1–R3 are **flag-only**. Discrepancies are returned by the Admin API (and logged); there is
no automatic repair, no ledger mutation, no order mutation. Repair of MISSING rows is
explicitly deferred and requires an ADR-sanctioned writer.

---

## 7. Reporting surface (Gate R2 preview)

Aggregates computed **from the ledger** (SUM over immutable rows — never a copied table):

```text
marketplace GMV                  = SUM(grossAmountInPaise)
commission earned                = SUM(commissionAmountInPaise)
commissionLedgerOrderCount       = COUNT(rows)   ← ledger rows, NOT the order
                                                   population (when missingCount > 0,
                                                   expected > rows)
zero-rate row count
effective rate                   = commission / GMV   (null when GMV = 0)
by channel / by period
+ reconciliation section: missing / amountMismatch / orphan / replayedRef counts
```

### Period-scoping rule (frozen)

**ALL order-derived diagnostics are period-scoped** — financials, MISSING,
REPLAYED_REF, AMOUNT_MISMATCH and the expected population all refer to
orders with `orderPlacedAt` inside the selected window. ORPHAN_LEDGER_ROW is
period-agnostic by design (a broken relationship is not a date-window
mismatch); RATE_DRIFT is a property of the selected ledger rows.

---

## 8. Gate R3 acceptance cases (preview)

| Case | Expected |
|---|---|
| marketplace order + row | MATCH |
| marketplace order, row missing (simulated insert error) | MISSING |
| replayed ref on 2nd order | order direct; REPLAYED_REF informational |
| direct order | excluded from expected population |
| 0% marketplace order | valid $0 row; MATCH |
| row with corrupted amount | AMOUNT_MISMATCH |
| cross-channel query | isolation — channel admin sees only own channel |