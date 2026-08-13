#!/usr/bin/env bash
set -e

HOST="${HOST:-http://localhost:3000}"
COOKIE_FILE="/tmp/customer-cookie.txt"

echo "=== Layer 2 Smoke Test: Shop API Contract Verification ==="
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

# Load Customer Credentials from fixture if available
CUSTOMER_USER="apex.customer@example.com"
CUSTOMER_PASS="DemoCustomer123!"
if [ -f "/tmp/demo-data.json" ]; then
  CUSTOMER_USER=$(node -p 'require("/tmp/demo-data.json").customerEmail || "apex.customer@example.com"')
  CUSTOMER_PASS=$(node -p 'require("/tmp/demo-data.json").customerPassword || "DemoCustomer123!"')
fi

# 1. Query Products (Public / Unauthenticated)
echo "[1] Testing Public Product Catalog..."
PRODUCTS_RESP=$(curl -s -X POST "$HOST/shop-api" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ products(options:{take:10}) { items { id name slug variants { id price } } } }"}'
)
validate_graphql "$PRODUCTS_RESP" "Public Product Catalog"

# 2. Customer Login
echo "[2] Testing Customer Login ($CUSTOMER_USER)..."
LOGIN_RESP=$(curl -s -X POST "$HOST/shop-api" \
  -H "Content-Type: application/json" \
  -c "$COOKIE_FILE" \
  -d "{\"query\":\"mutation { login(username:\\\"$CUSTOMER_USER\\\", password:\\\"$CUSTOMER_PASS\\\") { ... on CurrentUser { id identifier } } }\"}"
)
validate_graphql "$LOGIN_RESP" "Customer Login"

# 3. Customer Active Orders & Identity Query
echo "[3] Testing Customer Identity & Active Order State..."
ORDER_RESP=$(curl -s -X POST "$HOST/shop-api" \
  -H "Content-Type: application/json" \
  -b "$COOKIE_FILE" \
  -d '{"query":"{ activeCustomer { id firstName lastName emailAddress } activeOrder { id code totalWithTax lines { id quantity } } }"}'
)
validate_graphql "$ORDER_RESP" "Customer Active State Query"

echo "=== Shop API Contract Smoke Test Passed ==="
