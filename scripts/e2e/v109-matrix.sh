#!/usr/bin/env bash
# V1.0.9 — post-upgrade regression matrix (full matrix C from V1.0.1 §9).
# Sequential: each suite boots its own Nest server on its own port.
set -u
cd "$(dirname "$0")/../.."

OUT=/tmp/v109_matrix.log
: > "$OUT"

run() {
  local label="$1"; shift
  echo "===== BEGIN $label =====" >> "$OUT"
  "$@" >> "$OUT" 2>&1
  local rc=$?
  # Extract summary counts (strip ANSI)
  local summary
  summary=$(sed 's/\x1b\[[0-9;]*m//g' "$OUT" | grep -E '^ *(Test Files|Tests) ' | tail -n 2 | tr '\n' ' ')
  echo "===== END $label rc=$rc $summary" >> "$OUT"
  echo "rc=$rc $label"
}

V="npx vitest run --config vitest.config.mts"

run "tenant-plugin"          $V src/plugins/tenant-plugin/e2e/tenant-plugin.e2e-spec.ts
run "bbb-channel-isolation"  $V src/plugins/bigbluebutton-plugin/__tests__/bbb-channel-isolation.e2e-spec.ts
run "r4-lifecycle"           env R4_E2E=true $V src/plugins/bigbluebutton-plugin/e2e/r4-runtime-lifecycle.e2e-spec.ts
run "marketplace"            env MARKETPLACE_E2E=true $V src/plugins/marketplace/e2e/marketplace.e2e-spec.ts
run "commission"             env COMMISSION_E2E=true $V src/plugins/marketplace/e2e/commission.e2e-spec.ts
run "commission-recon"       env RECONCILIATION_E2E=true $V src/plugins/marketplace/e2e/commission-reconciliation.e2e-spec.ts
run "subscription-self-serve" $V src/plugins/subscription/__tests__/adr-046-self-serve.e2e-spec.ts
run "webhook-signature"      $V src/plugins/subscription/__tests__/webhook-signature-http.e2e-spec.ts
run "customer-deletion"      $V src/platform/customer-deletion/customer-deletion.e2e-spec.ts
run "security-financial"     $V src/platform/security/vendure-373-financial-boundary.e2e-spec.ts
run "security-isolation"     $V src/platform/security/vendure-373-channel-isolation.e2e-spec.ts
run "dashboard-contract"     $V src/plugins/subscription/__tests__/dashboard-graphql-contract.spec.ts

echo "===== MATRIX DONE =====" >> "$OUT"
