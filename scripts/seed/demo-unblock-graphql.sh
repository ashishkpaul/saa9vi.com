#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Demo Unblocker — Data-Only Fixture Preparation (Phase 1)
#
# This script prepares ONLY the preconditions for the browser-based journey.
# It does NOT create orders, payments, entitlements, or reviews.
#
# What it does:
#   1. Logs in as Admin (SuperAdmin via Vendure Admin auth endpoint)
#   2. Sets real stock (stockOnHand=10, trackInventory=ENABLED) on a product
#      variant via Admin GraphQL mutation updateProductVariant
#   3. Makes a scheduled session PUBLIC via Admin GraphQL mutation
#      updateBbbScheduledSession (status stays whatever it was — creation
#      defaults to SCHEDULED, so no separate status mutation is needed)
#   4. Triggers marketplace fullReindex via Admin GraphQL query
#      marketplaceFullReindex (SuperAdmin only)
#   5. Verifies state: stock >= 10, session visibility=PUBLIC,
#      marketplace contains session
#   6. Asserts NO entitlement or review was fabricated
#
# Run after:  npm run seed:demo-academy
# Run before: browser-based Admin -> Storefront journey
###############################################################################

HOST="${UNBLOCK_HOST:-http://localhost:3000}"
ADMIN_EMAIL="${UNBLOCK_ADMIN_EMAIL:-superadmin}"
ADMIN_PASS="${UNBLOCK_ADMIN_PASSWORD:-superadmin}"
VARIANT_SKU="${UNBLOCK_VARIANT_SKU:-PY-BOOTCAMP-01}"
SESSION_TITLE="${UNBLOCK_SESSION_TITLE:-Apex Python Bootcamp}"
DEMO_EMAIL="${UNBLOCK_CUSTOMER_EMAIL:-apex2.customer@example.com}"

COOKIE_FILE="/tmp/demo_unblock_admin_cookie.txt"
STATE_FILE="/tmp/demo-unblock-state.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "=== Demo Unblocker (GraphQL fixture prep) ==="
echo "Host: $HOST"

# ─── Helper: GraphQL admin query ─────────────────────────────────────────────
graphql_admin() {
  local query="$1"
  curl -sS -b "$COOKIE_FILE" \
    -X POST "$HOST/admin-api" \
    -H 'Content-Type: application/json' \
    -d "{\"query\": \"$query\"}"
}

# ─── Helper: extract JSON value via node ─────────────────────────────────────
jq_val() {
  node -e "
    try {
      const res = JSON.parse(process.argv[1]);
      const path = process.argv[2].split('.').filter(Boolean);
      let v = res;
      for (const p of path) { if (!v) break; v = v[p]; }
      process.stdout.write(v ?? '');
    } catch (e) { process.stdout.write(''); }
  " "$1" "$2"
}

# ─── Helper: assert ──────────────────────────────────────────────────────────
assert() {
  local label="$1"
  local condition="$2"
  local detail="${3:-}"
  if eval "$condition"; then
    echo -e "${GREEN}✓${NC} $label"
  else
    echo -e "${RED}✗${NC} $label"
    [ -n "$detail" ] && echo "       $detail"
    exit 1
  fi
}

# ─── 0. Health check ─────────────────────────────────────────────────────────
echo "[0] Health check..."
HEALTH=$(curl -sS -X POST "$HOST/shop-api" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ activeChannel { id code } }"}')
if ! echo "$HEALTH" | grep -q '"data"'; then
  echo -e "${RED}❌ Server not responding at $HOST/shop-api${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Server healthy"

# ─── 1. Admin login (SuperAdmin) ─────────────────────────────────────────────
echo "[1] Logging in as Admin ($ADMIN_EMAIL)..."
LOGIN_RESP=$(curl -sS -c "$COOKIE_FILE" -b "$COOKIE_FILE" \
  -X POST "$HOST/admin-api" \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\": \"mutation Login(\$username: String!, \$password: String!) {
      login(username: \$username, password: \$password) {
        __typename
        ... on CurrentUser { id identifier }
        ... on InvalidCredentialsError { message }
      }
    }\",
    \"variables\": { \"username\": \"$ADMIN_EMAIL\", \"password\": \"$ADMIN_PASS\" }
  }")

if echo "$LOGIN_RESP" | grep -q 'InvalidCredentialsError'; then
  echo -e "${RED}❌ Admin login failed (invalid credentials)${NC}"
  echo "    Response: $LOGIN_RESP"
  exit 1
fi

# Vendure sets the auth token in a cookie (vendure-auth-token)
ADMIN_TOKEN=$(grep -oP 'vendure-auth-token\s+\K[^;]+' "$COOKIE_FILE" 2>/dev/null || echo "")
if [ -z "$ADMIN_TOKEN" ]; then
  ADMIN_TOKEN=$(jq_val "$LOGIN_RESP" "data.login.token" 2>/dev/null || echo "")
fi
if [ -z "$ADMIN_TOKEN" ]; then
  echo -e "${RED}❌ Could not extract admin auth token${NC}"
  echo "    Cookie file:"
  cat "$COOKIE_FILE" 2>/dev/null || true
  echo "    Login response: $LOGIN_RESP"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Admin authenticated (token: ${ADMIN_TOKEN:0:20}...${ADMIN_TOKEN:20})"

# ─── 2. Set stock on product variant ─────────────────────────────────────────
echo "[2] Setting stock on variant SKU=$VARIANT_SKU (stockOnHand=10, trackInventory=ENABLED)..."

FIND_VARIANT=$(graphql_admin "{
  productVariants(options: { filter: { sku: { eq: \"$VARIANT_SKU\" } } }) {
    items { id sku stockOnHand trackInventory enabled }
  }
}")
VARIANT_ID=$(jq_val "$FIND_VARIANT" "data.productVariants.items.0.id")

if [ -z "$VARIANT_ID" ]; then
  echo -e "${RED}❌ Variant with SKU=$VARIANT_SKU not found${NC}"
  echo "    Response: $FIND_VARIANT"
  exit 1
fi
echo "    Found variant id=$VARIANT_ID sku=$VARIANT_SKU"

UPDATE_STOCK_RESP=$(graphql_admin "mutation UpdateVariantStock {
  updateProductVariant(input: {
    id: \"$VARIANT_ID\"
    stockOnHand: 10
    trackInventory: ENABLED
    outOfStockThreshold: 0
  }) {
    id sku stockOnHand trackInventory outOfStockThreshold
  }
}")

UPDATED_VARIANT=$(echo "$UPDATE_STOCK_RESP" | node -e "
  try {
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data;
    if (d?.updateProductVariant) process.stdout.write(JSON.stringify(d.updateProductVariant));
  } catch(e) { process.stdout.write(''); }
")

UPDATED_STOCK=$(jq_val "$UPDATED_VARIANT" "stockOnHand")
UPDATED_TRACK=$(jq_val "$UPDATED_VARIANT" "trackInventory")

assert "Stock set to 10" '[ "$UPDATED_STOCK" = "10" ]' "got stockOnHand=$UPDATED_STOCK"
assert "trackInventory=ENABLED" '[ "$UPDATED_TRACK" = "ENABLED" ]' "got trackInventory=$UPDATED_TRACK"
echo "    ✓ Variant stockOnHand=$UPDATED_STOCK trackInventory=$UPDATED_TRACK"

# ─── 3. Make scheduled session PUBLIC ────────────────────────────────────────
echo "[3] Setting session visibility=PUBLIC for session '$SESSION_TITLE'..."

# Discover the session by querying bbbScheduledSessions with a title filter.
# This avoids hard-coding organization IDs and works across any tenant layout.
SESSION_SEARCH=$(graphql_admin "{
  bbbScheduledSessions(options: { filter: { title: { eq: \"$SESSION_TITLE\" } } }) {
    items { id title visibility status startTime endTime productVariantId isTrial }
    totalItems
  }
}")

SESSION_ID=$(jq_val "$SESSION_SEARCH" "data.bbbScheduledSessions.items.0.id")
SESSION_TOTAL=$(jq_val "$SESSION_SEARCH" "data.bbbScheduledSessions.totalItems")

if [ -z "$SESSION_ID" ] || [ "$SESSION_TOTAL" = "0" ]; then
  echo -e "${RED}❌ Session '$SESSION_TITLE' not found${NC}"
  echo "    Queried bbbScheduledSessions with title filter — totalItems=$SESSION_TOTAL"
  exit 1
fi

SESSION_VISIBILITY_BEFORE=$(jq_val "$SESSION_SEARCH" "data.bbbScheduledSessions.items.0.visibility")
SESSION_STATUS=$(jq_val "$SESSION_SEARCH" "data.bbbScheduledSessions.items.0.status")
SESSION_START=$(jq_val "$SESSION_SEARCH" "data.bbbScheduledSessions.items.0.startTime")
SESSION_END=$(jq_val "$SESSION_SEARCH" "data.bbbScheduledSessions.items.0.endTime")
SESSION_VARIANT_ID=$(jq_val "$SESSION_SEARCH" "data.bbbScheduledSessions.items.0.productVariantId")
SESSION_ISTRIAL=$(jq_val "$SESSION_SEARCH" "data.bbbScheduledSessions.items.0.isTrial")

echo "    Found session id=$SESSION_ID title=$SESSION_TITLE visibility=$SESSION_VISIBILITY_BEFORE status=$SESSION_STATUS (total=$SESSION_TOTAL)"

# Update session visibility to PUBLIC
# NOTE: UpdateBbbScheduledSessionInput does NOT have a 'status' field.
# Status is managed internally. On creation, status defaults to 'SCHEDULED'.
UPDATE_SESSION_RESP=$(graphql_admin "mutation UpdateSession {
  updateBbbScheduledSession(id: \"$SESSION_ID\", input: {
    visibility: \"PUBLIC\"
  }) {
    id title visibility status startTime endTime
  }
}")

UPDATED_SESSION=$(echo "$UPDATE_SESSION_RESP" | node -e "
  try {
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data;
    if (d?.updateBbbScheduledSession) process.stdout.write(JSON.stringify(d.updateBbbScheduledSession));
  } catch(e) { process.stdout.write(''); }
")

UPDATED_VISIBILITY=$(jq_val "$UPDATED_SESSION" "visibility")
UPDATED_STATUS=$(jq_val "$UPDATED_SESSION" "status")

assert "Session visibility=PUBLIC" '[ "$UPDATED_VISIBILITY" = "PUBLIC" ]' "got visibility=$UPDATED_VISIBILITY"
echo "    ✓ Session visibility=$UPDATED_VISIBILITY status=$UPDATED_STATUS"

# ─── 4. Trigger marketplace full reindex ─────────────────────────────────────
echo "[4] Triggering marketplace full reindex..."

REINDEX_RESP=$(graphql_admin 'query { marketplaceFullReindex }')
REINDEX_RESULT=$(jq_val "$REINDEX_RESP" "data.marketplaceFullReindex")

assert "Marketplace reindex succeeded" '[ "$REINDEX_RESULT" = "true" ]' "got marketplaceFullReindex=$REINDEX_RESULT"
echo "    ✓ Marketplace full reindex completed"

# ─── 5. Read-only verification ───────────────────────────────────────────────
echo ""
echo "[5] Read-only verification..."

# 5a. Verify variant stock
VERIFY_VARIANT=$(graphql_admin "{
  productVariants(options: { filter: { sku: { eq: \"$VARIANT_SKU\" } } }) {
    items { id sku stockOnHand trackInventory }
  }
}")
V_STOCK=$(jq_val "$VERIFY_VARIANT" "data.productVariants.items.0.stockOnHand")
V_SKU_CHECK=$(jq_val "$VERIFY_VARIANT" "data.productVariants.items.0.sku")
assert "Variant found by SKU=$VARIANT_SKU" '[ -n "$V_SKU_CHECK" ]' "no variant with sku=$VARIANT_SKU"
assert "Verified stockOnHand=10" '[ "$V_STOCK" = "10" ]' "stockOnHand=$V_STOCK"
echo "    ✓ Variant sku=$V_SKU_CHECK stockOnHand=$V_STOCK"

# 5b. Verify session visibility
VERIFY_SESSION=$(graphql_admin "{
  bbbScheduledSession(id: \"$SESSION_ID\") {
    id title visibility status startTime endTime
  }
}")
VS_VISIBILITY=$(jq_val "$VERIFY_SESSION" "data.bbbScheduledSession.visibility")
VS_STATUS=$(jq_val "$VERIFY_SESSION" "data.bbbScheduledSession.status")
assert "Verified session visibility=PUBLIC" '[ "$VS_VISIBILITY" = "PUBLIC" ]' "visibility=$VS_VISIBILITY"
echo "    ✓ Session visibility=$VS_VISIBILITY status=$VS_STATUS"

# 5c. Verify marketplace search returns the session
MARKETPLACE_SEARCH=$(curl -sS -X POST "$HOST/shop-api" \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\": \"query(\$term: String!) {
      marketplaceSearch(term: \$term, options: { skip: 0, take: 5 }) {
        items { id title status visibility slug }
        totalItems
      }
    }\",
    \"variables\": { \"term\": \"$SESSION_TITLE\" }
  }")
MS_TOTAL=$(jq_val "$MARKETPLACE_SEARCH" "data.marketplaceSearch.totalItems")
assert "Marketplace search returns session" \
  '[ "$MS_TOTAL" -ge 1 ]' \
  "totalItems=$MS_TOTAL"
echo "    ✓ Marketplace search totalItems=$MS_TOTAL"

# ─── 6. Assert NO fabricated business outcomes ───────────────────────────────
echo ""
echo "[6] Asserting NO fabricated business outcomes..."

# DEMO_EMAIL is declared at top of script (line 32) — uses UNBLOCK_CUSTOMER_EMAIL
CUSTOMER_SEARCH=$(graphql_admin "{
  customers(options: { filter: { emailAddress: { eq: \"$DEMO_EMAIL\" } } }) {
    items { id emailAddress }
  }
}")
CUST_ID=$(jq_val "$CUSTOMER_SEARCH" "data.customers.items.0.id")

assert "Demo customer exists ($DEMO_EMAIL)" '[ -n "$CUST_ID" ]' \
  "customer with email=$DEMO_EMAIL not found — required for fixture boundary verification"

ENTITLEMENT_CHECK=$(graphql_admin "{
  bbbEntitlements(options: { filter: { customerId: { eq: \"$CUST_ID\" } } }) {
    items { id type resourceId source }
    totalItems
  }
}")
ENT_TOTAL=$(jq_val "$ENTITLEMENT_CHECK" "data.bbbEntitlements.totalItems")
assert "No entitlement for demo customer ($DEMO_EMAIL)" \
  '[ "$ENT_TOTAL" = "0" ]' \
  "found $ENT_TOTAL entitlements (expected 0)"
echo "    ✓ No entitlements for $DEMO_EMAIL (count=$ENT_TOTAL)"

# Check no reviews for the product
PRODUCT_CHECK=$(graphql_admin "{
  productVariants(options: { filter: { sku: { eq: \"$VARIANT_SKU\" } } }) {
    items { id product { id name } }
  }
}")
PRODUCT_ID=$(jq_val "$PRODUCT_CHECK" "data.productVariants.items.0.product.id")

if [ -n "$PRODUCT_ID" ]; then
  REVIEW_CHECK=$(graphql_admin "{
    productReviews(options: { filter: { productId: { eq: \"$PRODUCT_ID\" } } }) {
      items { id authorName state rating }
      totalItems
    }
  }")
  REV_TOTAL=$(jq_val "$REVIEW_CHECK" "data.productReviews.totalItems")
  assert "No reviews for product" \
    '[ "$REV_TOTAL" = "0" ]' \
    "found $REV_TOTAL reviews (expected 0)"
  echo "    ✓ No reviews for product (count=$REV_TOTAL)"
else
  echo -e "    ${RED}✗${NC} Product not found for SKU=$VARIANT_SKU — cannot verify review boundary"
  exit 1
fi

# Check orders — must assert zero for clean fixture boundary
ORDER_CHECK=$(graphql_admin "{
  orders(options: { filter: { code: { contains: \"$VARIANT_SKU\" } } }) {
    items { id code state total }
    totalItems
  }
}")
ORDER_TOTAL=$(jq_val "$ORDER_CHECK" "data.orders.totalItems")
assert "No orders for $VARIANT_SKU (clean fixture boundary)" \
  '[ "$ORDER_TOTAL" = "0" ]' \
  "found $ORDER_TOTAL orders (expected 0 for fixture prep)"
echo "    ✓ No orders matching '$VARIANT_SKU' (count=$ORDER_TOTAL)"

# ─── 7. Write state file ─────────────────────────────────────────────────────
echo ""
echo "[7] Writing state to $STATE_FILE..."

cat > "$STATE_FILE" << EOF
{
  "channel": {
    "id": "$(jq_val "$HEALTH" "data.activeChannel.id")",
    "code": "$(jq_val "$HEALTH" "data.activeChannel.code")",
    "token": "$(jq_val "$HEALTH" "data.activeChannel.token")"
  },
  "productVariant": {
    "id": "$VARIANT_ID",
    "sku": "$VARIANT_SKU",
    "stockOnHand": $UPDATED_STOCK,
    "trackInventory": "$UPDATED_TRACK"
  },
  "session": {
    "id": "$SESSION_ID",
    "title": "$SESSION_TITLE",
    "visibility": "$UPDATED_VISIBILITY",
    "status": "$UPDATED_STATUS",
    "startTime": "$SESSION_START",
    "endTime": "$SESSION_END",
    "productVariantId": "$SESSION_VARIANT_ID",
    "isTrial": $SESSION_ISTRIAL
  },
  "customer": {
    "email": "$DEMO_EMAIL"
  },
  "marketplace": {
    "reindexed": true,
    "searchTotalItems": $MS_TOTAL
  }
}
EOF

echo -e "  ${GREEN}✓${NC} State written to $STATE_FILE"
cat "$STATE_FILE"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Demo unblock complete — no outcomes fabricated${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Open Admin Dashboard at $HOST/admin"
echo "  2. Verify: variant stockOnHand=10, session visibility=PUBLIC"
echo "  3. Open storefront and navigate to the product/session"
echo "  4. Complete the real customer journey (cart → checkout → payment → order → entitlement → review)"
echo "  5. Run verify:demo-data to validate read-only state"
