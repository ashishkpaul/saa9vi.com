#!/usr/bin/env bash
set -e

HOST="${HOST:-http://localhost:3000}"
COOKIE_FILE="/tmp/superadmin-cookie.txt"

echo "=== Layer 2 Smoke Test: Admin API Contract Verification ==="
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

# 1. SuperAdmin Login
echo "[1] Testing SuperAdmin Login..."
LOGIN_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -c "$COOKIE_FILE" \
  -d '{"query":"mutation { login(username:\"superadmin\", password:\"superadmin\") { ... on CurrentUser { id identifier } } }"}'
)
validate_graphql "$LOGIN_RESP" "SuperAdmin Login"

# 2. Query Channels
echo "[2] Testing Channels Discovery..."
CHANNELS_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -b "$COOKIE_FILE" \
  -d '{"query":"{ channels { items { id code token } } }"}'
)
validate_graphql "$CHANNELS_RESP" "Channels Discovery"

# 3. Query Global Products Catalog
echo "[3] Testing Global Products Admin Query..."
PRODUCTS_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -b "$COOKIE_FILE" \
  -d '{"query":"{ products(options:{take:10}) { items { id name slug } } }"}'
)
validate_graphql "$PRODUCTS_RESP" "Products Admin Query"

echo "=== Admin API Contract Smoke Test Passed ==="
