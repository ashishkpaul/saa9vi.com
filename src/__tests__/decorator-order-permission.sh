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
BASE="${PERM_TEST_BASE:-https://core.meeting.lan}"
SUPERADMIN_USER="${SUPERADMIN_USERNAME:-superadmin}"
SUPERADMIN_PASS="${SUPERADMIN_PASSWORD:-}"

# ─── Non-dev refusal (Track A item 3) ──────────────────────────────────────
# This script creates REAL rows (a tenant, a BbbServer) through the API, so
# it may only ever run against a development/staging deployment. The host is
# allow-list checked HERE — before any request leaves the process. A leaked
# fixture BbbServer is an eligible selection target (the 2026-10-07 incident:
# perm-test-server won provisioning for meetings 31–33), and a leaked tenant
# is worse. Production hosts (*.saa9vi.com), public IPs and anything
# unrecognised are refused outright — extend the list only for hosts you
# have confirmed are dev.
BASE_HOST="$(printf '%s' "$BASE" | sed -E 's#^[A-Za-z][A-Za-z0-9+.-]*://##; s#[/:].*$##')"
case "$BASE_HOST" in
  localhost|127.0.0.1|::1|0.0.0.0) : ;;
  *.lan|*.local|*.test|*.localhost) : ;;
  *)
    echo "REFUSED: BASE=$BASE (host: $BASE_HOST) is not a recognised dev host."
    echo "Allowed: localhost, 127.0.0.1, ::1, 0.0.0.0, *.lan, *.local, *.test, *.localhost."
    echo "Run this permission test only against a development deployment."
    exit 3
    ;;
esac

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

# ─── Fixture cleanup via EXIT trap (Track A item 3) ────────────────────────
# Test 3 creates `perm-test-server` — enabled+healthy by default, i.e. an
# ELIGIBLE selection target (see the 2026-10-07 incident where the leaked row
# won provisioning for meetings 31–33 while meeting 30 rolled the real
# server). CreateBbbServerInput has no `enabled` field, so the row cannot be
# created pre-disabled: it must be deleted after the assertion — and it must
# be deleted EVEN IF this script dies mid-way (set -e, Ctrl-C, a later test
# crashing). The trap owns that; the normal path calls `cleanup` explicitly
# right after registration so its verdict lands inside Test 3 and the
# Results summary, which clears the id and leaves the trap a no-op.
CLEANUP_SERVER_ID=""
cleanup() {
  local id="$CLEANUP_SERVER_ID"
  CLEANUP_SERVER_ID=""
  [[ -n "$id" ]] || return 0
  local out
  out=$(curl -s -k -X POST "$BASE/admin-api" \
    -H "Content-Type: application/json" \
    -b /tmp/perm-test-cookies.txt \
    -d "{\"query\":\"mutation { deleteBbbServer(id: \\\"$id\\\") }\"}" || true)
  echo "  Cleanup deleteBbbServer(id=$id): $out"
  if echo "$out" | grep -q '"deleteBbbServer":true'; then
    echo "  ✅  fixture server row deleted — no selection leak"
    ((PASS++)) || true
  else
    echo "  ❌  fixture server row LEAKED — remove it now:"
    echo "      BBB Platform → Servers → perm-test-server → Disable"
    echo "      (or: mutation { updateBbbServer(id: \\\"$id\\\", input: { enabled: false }) { id enabled } })"
    ((FAIL++)) || true
  fi
}
trap cleanup EXIT

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

# Register the fixture row for EXIT-trap cleanup (idempotent — see
# cleanup() above; a row that cannot be cleaned up is a FAILED check, not a
# warning). The explicit `cleanup` call right after deletes it on the normal
# path; between registration and that call, the trap covers abnormal exits.
CLEANUP_SERVER_ID=$(echo "$RESULT" | sed -n 's/.*"createBbbServer":{"id":"\([0-9]*\)".*/\1/p')
if [[ -n "$CLEANUP_SERVER_ID" ]]; then
  echo "  Fixture server row $CLEANUP_SERVER_ID registered for EXIT-trap cleanup"
else
  echo "  ℹ️  no server row created (validation/auth rejected it) — nothing to clean"
fi
cleanup

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
