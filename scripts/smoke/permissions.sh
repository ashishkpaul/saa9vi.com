#!/usr/bin/env bash
set -e

HOST="${HOST:-http://localhost:3000}"
MOD_COOKIE="/tmp/moderator-cookie.txt"

echo "=== Layer 2 Smoke Test: Tenant Moderator Permission & Authorization Verification ==="
echo "Target host: $HOST"

validate_graphql() {
  local response="$1"
  local label="$2"
  node -e '
    try {
      const res = JSON.parse(process.argv[1]);
      if (res.errors && res.errors.length > 0) {
        console.error("  ❌ [GraphQL Error - " + process.argv[2] + "]:", JSON.stringify(res.errors, null, 2));
        process.exit(1);
      }
      if (!res.data) {
        console.error("  ❌ [GraphQL Error - " + process.argv[2] + "]: Missing data payload!");
        process.exit(1);
      }
      console.log("  ✓ " + process.argv[2] + " contract verified.");
    } catch (err) {
      console.error("  ❌ [Response Parse Error - " + process.argv[2] + "]:", err.message, process.argv[1]);
      process.exit(1);
    }
  ' "$response" "$label"
}

validate_forbidden() {
  local response="$1"
  local label="$2"
  node -e '
    try {
      const res = JSON.parse(process.argv[1]);
      if (res.errors && res.errors.length > 0) {
        const err = res.errors[0];
        const msg = (err.message || "").toLowerCase();
        const code = ((err.extensions && err.extensions.code) || "").toLowerCase();
        if (msg.includes("forbidden") || msg.includes("unauthorized") || msg.includes("permission") || code.includes("forbidden")) {
          console.log("  ✓ " + process.argv[2] + " correctly restricted (Returned expected authorization error: " + err.message + ")");
          process.exit(0);
        } else {
          console.error("  ❌ [Unexpected Error - " + process.argv[2] + "]: Got error that is NOT an authorization error:", JSON.stringify(res.errors, null, 2));
          process.exit(1);
        }
      }
      if (res.data && res.data.channels && res.data.channels.items) {
        if (res.data.channels.items.length <= 1) {
          console.log("  ✓ " + process.argv[2] + " correctly channel-scoped (returned " + res.data.channels.items.length + " channel).");
          process.exit(0);
        } else {
          console.error("  ❌ [Scope Violation - " + process.argv[2] + "]: Tenant moderator saw " + res.data.channels.items.length + " channels (expected channel isolation)!");
          process.exit(1);
        }
      }
      console.log("  ✓ " + process.argv[2] + " boundary verified.");
    } catch (err) {
      console.error("  ❌ [Parse Error - " + process.argv[2] + "]:", err.message);
      process.exit(1);
    }
  ' "$response" "$label"
}

MOD_USER="apex.moderator@example.com"
MOD_PASS="DemoModerator123!"
CHANNEL_HEADER=""
if [ -f "/tmp/demo-data.json" ]; then
  MOD_USER=$(node -p 'require("/tmp/demo-data.json").moderatorEmail || "apex.moderator@example.com"')
  MOD_PASS=$(node -p 'require("/tmp/demo-data.json").moderatorPassword || "DemoModerator123!"')
  TOKEN=$(node -p 'require("/tmp/demo-data.json").channelToken || ""')
  if [ -n "$TOKEN" ]; then
    CHANNEL_HEADER="-H vendure-token:$TOKEN"
  fi
fi

# 1. Moderator Login
echo "[1] Testing Moderator Login ($MOD_USER)..."
LOGIN_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  $CHANNEL_HEADER \
  -c "$MOD_COOKIE" \
  -d "{\"query\":\"mutation { login(username:\\\"$MOD_USER\\\", password:\\\"$MOD_PASS\\\") { ... on CurrentUser { id identifier } } }\"}"
)
validate_graphql "$LOGIN_RESP" "Moderator Login"

# 2. Check Active Channel & Tenant Scope
echo "[2] Testing Moderator Active Channel & Tenant Scope..."
PROFILE_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  $CHANNEL_HEADER \
  -b "$MOD_COOKIE" \
  -d '{"query":"{ activeChannel { id code token } me { id identifier } }"}'
)
validate_graphql "$PROFILE_RESP" "Moderator Active Channel & Identity"

# 3. Test Authorized Tenant-Scoped Query (Products within Tenant Context)
echo "[3] Testing Authorized Tenant-Scoped Catalog Query..."
TENANT_PROD_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  $CHANNEL_HEADER \
  -b "$MOD_COOKIE" \
  -d '{"query":"{ products(options:{take:5}) { items { id name slug } } }"}'
)
validate_graphql "$TENANT_PROD_RESP" "Tenant Products Query"

# 4. Test Permission Boundary (Moderator querying global multi-channel list)
echo "[4] Testing Permission Boundary (Global Channel Isolation)..."
CHANNELS_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -b "$MOD_COOKIE" \
  -d '{"query":"{ channels { items { id code token } } }"}'
)
validate_forbidden "$CHANNELS_RESP" "Global Channel Scope Isolation"

echo "=== Permission & Authorization Smoke Test Passed ==="
