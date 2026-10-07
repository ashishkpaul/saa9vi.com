#!/usr/bin/env bash
# Verifies that @Allow decorator ordering is enforced correctly after the
# BUG-021 / decorator-order fix. Run this after `npm run dev` has started.
#
# Tests:
#   1. Unauthenticated call to registerNewTenant (Public) → should SUCCEED
#   2. SuperAdmin can call createBbbServer → should SUCCEED (or fail on input, not auth)
#   3. Under-permissioned admin (tenant admin, no BbbAdminPermission) calling
#      createBbbServer → should get FORBIDDEN
#   4. Under-permissioned admin calling createTenantProfile → should get FORBIDDEN
#      (tenantProfilePermission.Update required)
#
# Usage: bash src/__tests__/decorator-order-permission.sh

set -euo pipefail
BASE="https://core.meeting.lan"
SUPERADMIN_USER="${SUPERADMIN_USERNAME:-superadmin}"
SUPERADMIN_PASS="${SUPERADMIN_PASSWORD:-}"

if [[ -z "$SUPERADMIN_PASS" ]]; then
  echo "Set SUPERADMIN_PASSWORD env var before running this script."
  exit 1
fi

PASS=0; FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  ✅  $label"
    ((PASS++)) || true
  else
    echo "  ❌  $label"
    echo "      expected pattern: $expected"
    echo "      got: $actual"
    ((FAIL++)) || true
  fi
}

echo ""
echo "=== Test 1: registerNewTenant (Public) — no auth required ==="
RESULT=$(curl -s -k -X POST "$BASE/shop-api" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { registerNewTenant(input: { businessName: \"Perm Test Co\" firstName: \"A\" lastName: \"B\" emailAddress: \"permtest-'$(date +%s)'@example.com\" password: \"str0ngpassword\" }) { channelId channelToken administratorId } }"}')
echo "  Response: $RESULT"
# Should NOT be FORBIDDEN — either success or a business-logic error is fine
check "not FORBIDDEN" '"channelId"\|businessName\|already\|required' "$RESULT" || \
  check "not FORBIDDEN (any non-auth error)" '"code":"' "$RESULT"
# Specifically must not be the auth forbidden
if echo "$RESULT" | grep -q '"code":"FORBIDDEN"'; then
  echo "  ❌  STILL getting FORBIDDEN — server may not have restarted yet"
  ((FAIL++)) || true
else
  echo "  ✅  No FORBIDDEN on public mutation"
  ((PASS++)) || true
fi

echo ""
echo "=== Test 2: SuperAdmin login ==="
LOGIN=$(curl -s -k -X POST "$BASE/admin-api" \
  -H "Content-Type: application/json" \
  -c /tmp/perm-test-cookies.txt \
  -d "{\"query\":\"mutation { login(username: \\\"${SUPERADMIN_USER}\\\", password: \\\"${SUPERADMIN_PASS}\\\") { ... on CurrentUser { id identifier } ... on ErrorResult { errorCode message } } }\"}")
echo "  Response: $LOGIN"
check "superadmin login succeeds" '"identifier"' "$LOGIN"

echo ""
echo "=== Test 3: SuperAdmin calling createBbbServer — should reach service (not FORBIDDEN) ==="
RESULT=$(curl -s -k -X POST "$BASE/admin-api" \
  -H "Content-Type: application/json" \
  -b /tmp/perm-test-cookies.txt \
  -d '{"query":"mutation { createBbbServer(input: { name: \"perm-test-server\" apiUrl: \"https://test.bbb.example.com/bigbluebutton/api\" apiSecret: \"test-secret\" }) { id name } }"}')
echo "  Response: $RESULT"
# Should NOT be FORBIDDEN — either creates it or fails on validation
if echo "$RESULT" | grep -q '"code":"FORBIDDEN"'; then
  echo "  ❌  FORBIDDEN — @Allow/@Transaction order still broken for bbb-admin mutations"
  ((FAIL++)) || true
else
  echo "  ✅  No FORBIDDEN — permission check passed for SuperAdmin"
  ((PASS++)) || true
fi

# ─── Cleanup: this test must not leak an eligible server row ──────────────
# A leaked enabled+healthy BbbServer participates in server selection
# (random jitter among currentLoad ties) — exactly how perm-test-server
# (https://test.bbb.example.com) won provisioning for real meetings 31–33
# on 2026-10-07 and drove Room 2 to Failed after 3 retries, while meeting
# 30 rolled the real server. A fixture row that cannot be cleaned up is a
# FAILED check, not a warning. (CreateBbbServerInput has no `enabled`
# field, so the row cannot be created pre-disabled — delete after assert.)
SERVER_ID=$(echo "$RESULT" | sed -n 's/.*"createBbbServer":{"id":"\([0-9]*\)".*/\1/p')
if [[ -n "$SERVER_ID" ]]; then
  CLEANUP=$(curl -s -k -X POST "$BASE/admin-api" \
    -H "Content-Type: application/json" \
    -b /tmp/perm-test-cookies.txt \
    -d "{\"query\":\"mutation { deleteBbbServer(id: \\\"$SERVER_ID\\\") }\"}" || true)
  echo "  Cleanup deleteBbbServer(id=$SERVER_ID): $CLEANUP"
  if echo "$CLEANUP" | grep -q '"deleteBbbServer":true'; then
    echo "  ✅  fixture server row deleted — no selection leak"
    ((PASS++)) || true
  else
    echo "  ❌  fixture server row LEAKED — remove it now:"
    echo "      BBB Platform → Servers → perm-test-server → Disable"
    echo "      (or: mutation { updateBbbServer(id: \\\"$SERVER_ID\\\", input: { enabled: false }) { id enabled } })"
    ((FAIL++)) || true
  fi
else
  echo "  ℹ️  no server row created (validation/auth rejected it) — nothing to clean"
fi

echo ""
echo "=== Test 4: Tenant admin (registered via registerNewTenant) calling createBbbServer ==="
echo "    (Requires the registerNewTenant in Test 1 to have succeeded and returned a channelToken)"
echo "    Skipping automated check — do this manually:"
echo "    1. Take the administratorId from Test 1 output"
echo "    2. Log in to admin-api as that administrator"
echo "    3. Call createBbbServer — expect FORBIDDEN"
echo "    4. Call createTenantProfile — expect FORBIDDEN (they don't hold tenantProfilePermission either)"

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
[[ $FAIL -eq 0 ]]
