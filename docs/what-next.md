# What Next — Saa9vi Platform

**Updated:** 2026-08-30

## Documentation Architecture

| Directory | Document | Purpose |
|---|---|---|
| `docs/architecture/` | `platform-adr.md` | Enduring architectural decisions |
| `docs/architecture/` | `domain-model.md` | Aggregates, lifecycles, relationships |
| `docs/architecture/` | `plugin-map.md` | Plugin ownership and API surfaces |
| `docs/architecture/` | `runtime-flow.md` | Event-driven flows and queues |
| `docs/architecture/` | `invariants.md` | Non-negotiable platform rules |
| `docs/product/` | `platform-story.md` | Actor/capability lifecycles |
| `docs/product/` | `glossary.md` | Domain terminology |
| `docs/implementation/` | `roadmap.md` | Future work only |
| `docs/implementation/` | `known-bugs.md` | Active and fixed bugs |
| `docs/implementation/` | `release-notes.md` | Completed work |

---

## Current State — 2026-08-30

### Verified complete

- TypeScript build succeeds (`npm run build`).
- Vendure starts successfully on v3.6.5.
- SubscriptionPlan / OrganizationSubscription foundation is implemented.
- BbbPlatformCapacityPolicy and plan-based capacity enforcement are implemented.
- Capacity policy Portal Admin API/dashboard is implemented.
- Juspay recurring billing Steps 0–4 implementation is present:
  - mandate/payment-attempt/webhook entities;
  - INV-019 payment-attempt ledger semantics;
  - renewal CLAIM → ATTEMPT → CHARGE → FINALIZE state model;
  - fail-closed webhook authentication and raw-body verification;
  - persist-before-process webhook ingestion;
  - BullMQ webhook processing;
  - per-tenant webhook endpoints;
  - webhook reconciliation of the existing initiated attempt;
  - asynchronous real-charge semantics (`initiated` is not payment success);
  - terminal success is webhook-authoritative;
  - failed charges move the subscription to `past_due`;
  - successful-charge finalize conflicts become reconciliation incidents.

### Still pending before calling Juspay production-ready

1. **Provider-contract verification** — verify the exact sandbox/live Juspay mandate, charge, webhook, signature, idempotency, retry, order-ID and transaction-ID contracts. The implementation seam is ready; provider verification is still a release gate.
2. **Portal Admin billing surface** — read-only mandate status, payment-attempt ledger, webhook/reconciliation incidents and operational filters.
3. **Production hardening** — encrypt stored webhook credentials, complete secrets review, verify production credentials, and finish regression/e2e coverage.

### Runtime environment issue found on 2026-08-30

The application was started with:

```text
DB_HOST=localhost
DB_PORT=5435
REDIS_HOST=localhost
REDIS_PORT=6385
```

The intended development infrastructure is supplied by Cloudflare Access TCP tunnels:

```text
cloudflared access tcp --hostname db.saa9vi.com --url 127.0.0.1:5435
cloudflared access tcp --hostname redis.saa9vi.com --url 127.0.0.1:6385
```

The tunnels reported local listeners, but the application still reported PostgreSQL and Redis as unreachable and therefore fell back to pg-mem and `DefaultJobQueuePlugin`.

**Next verification:** use `127.0.0.1` rather than `localhost` in `.env`, then independently verify the tunnels with `pg_isready`/`psql` and `redis-cli` before starting Vendure. The current startup log proves that the fallback path works; it does not prove connectivity to the intended public PostgreSQL/Redis services.

For real runtime verification, the application must start against the intended PostgreSQL and Redis services rather than the fallback implementations.

---

## Phase 2 — Remaining Work

```text
PHASE 2 — SUBSCRIPTION BILLING & CAPACITY POLICY

[x] SubscriptionPlan / OrganizationSubscription
[x] BbbPlatformCapacityPolicy
[x] Starter / Growth / Enterprise capacity tiers
[x] Plan-based BBB room capacity enforcement
[x] Portal Admin capacity policy surface
[x] Subscription capacity-grant integration
[x] Juspay Steps 0–4 implementation

[ ] Juspay provider-contract verification
[ ] Portal Admin billing/mandate/payment-attempt surface
[ ] Production credential/secrets hardening
[ ] Final Juspay regression/e2e verification

[ ] Tenant onboarding flow in storefront
[ ] NavigationMenu entity in CMS
[ ] Banner BullMQ scheduling
[ ] Custom-domain routing via Caddy
```

## Phase 3 — Marketplace & Retention

Planned work remains the marketplace read projection/search, commission ledger, advertising stream, retention/analytics and related capabilities documented in `docs/implementation/roadmap.md`.

## Phase 4 — Scale & Premium

Planned work remains white-label theming, TimescaleDB analytics, AI features, multi-BBB-server routing, Student Corner, placement network and CRM/telephony integration.

## Important architectural boundary

Do not create a second billing engine or second payment-attempt model. The current recurring-billing architecture is:

```text
Due OrganizationSubscription
        ↓
CLAIM CAS
        ↓
JuspayPaymentAttempt (initiated)
        ↓
Juspay charge request
        ↓
Juspay webhook
        ↓
reconcile existing attempt
        ↓
CHARGE_SUCCEEDED → FINALIZE CAS
CHARGE_FAILED    → past_due
```

A successful HTTP response from the real Juspay charge request means the request was accepted/initiated; it is not terminal payment success. This distinction must remain intact.

The storefront template contract remains owned by the `nextjs-starter-vendure` repository and is intentionally not duplicated here.
