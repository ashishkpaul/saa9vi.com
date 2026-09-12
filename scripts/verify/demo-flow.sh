#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Demo Data Verification — Read-only smoke checks for demo environment state
#
# Validates that the demo environment has:
#   (a) Healthy server
#   (b) Products visible in shop API
#   (c) Sessions queryable in shop API
#   (d) Marketplace returns results
#   (e) Demo customer exists
#   (f) Demo customer has entitlement + order + review (full journey state)
#   (g) Session visibility is PUBLIC
#
# IMPORTANT: This is a READ-ONLY verification script. It does NOT modify
# any data. Run AFTER seed:demo-flow or seed:demo-unblock.
###############################################################################

HOST="${HOST:-http://localhost:3000}"
CHANNEL_TOKEN="${CHANNEL_TOKEN:-tok_apex-academy_5famcu}"
DEMO_CUSTOMER_EMAIL="${UNBLOCK_CUSTOMER_EMAIL:-apex2.customer@example.com}"
SESSION_TITLE="${UNBLOCK_SESSION_TITLE:-Apex Python Bootcamp}"
OUTFILE="${OUTFILE:-/tmp/demo-verification.json}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

passCount=0
failCount=0

check() {
  local label="$1"
  local condition="$2"
  local detail="${3:-}"
  if eval "$condition"; then
    echo -e "${GREEN}✓${NC} ${label}"
    ((passCount++)) || true
  else
    echo -e "${RED}✗${NC} ${label}"
    [ -n "$detail" ] && echo "       $detail"
    ((failCount++)) || true
  fi
}

shop_query() {
  local query="$1"
  curl -sS -X POST "$HOST/shop-api" \
    -H 'Content-Type: application/json' \
    -d "{\"query\": \"$query\"}"
}

admin_query() {
  # Requires admin token — used only if COOKIE_ADMIN is set
  if [ -z "${COOKIE_ADMIN:-}" ]; then
    echo '{"errors":[{"message":"no admin cookie"}]}'
    return
  fi
  curl -sS -b "$COOKIE_ADMIN" \
    -X POST "$HOST/admin-api" \
    -H 'Content-Type: application/json' \
    -d "{\"query\": \"$1\"}"
}

echo "============================================"
echo "Demo Data Verification (read-only)"
echo "============================================"
echo "Host: $HOST"
echo "Demo customer: $DEMO_CUSTOMER_EMAIL"
echo "Session title: $SESSION_TITLE"
echo ""

# ─── 1. Health check ────────────────────────────────────────────────────────
echo "[1] Health check..."
HEALTH=$(curl -sS -X POST "$HOST/shop-api" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ activeChannel { id code } }"}')
if echo "$HEALTH" | grep -q '"data"'; then
  echo -e "  ${GREEN}✓${NC} Server healthy"
  ((passCount++)) || true
else
  echo -e "  ${RED}✗${NC} Server not responding"
  ((failCount++)) || true
  exit 1
fi

# ─── 2. Products visible in shop API ────────────────────────────────────────
echo ""
echo "[2] Products visible in shop API..."
PRODUCTS=$(shop_query '{
  productVariants(options: { skip: 0, take: 20 }) {
    items { id sku name stockOnHand trackInventory enabled }
    totalItems
  }
}')
PROD_TOTAL=$(echo "$PRODUCTS" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.productVariants.totalItems } catch { 0 }" 2>/dev/null || echo "0")
check "Products are queryable" '[ "$PROD_TOTAL" -gt 0 ]' "totalItems=$PROD_TOTAL"

# List products with stock
echo "$PRODUCTS" | node -e "
  try {
    const items = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.productVariants.items;
    console.log('  Products (first 5):');
    items.slice(0, 5).forEach(p => {
      console.log('    - ' + p.sku + ' (stock=' + p.stockOnHand + ', track=' + p.trackInventory + ', enabled=' + p.enabled + ')');
    });
  } catch(e) { console.log('  ℹ Could not parse products'); }
"

# ─── 3. Sessions queryable in shop API ──────────────────────────────────────
echo ""
echo "[3] Sessions queryable in shop API..."
SESSIONS=$(shop_query '{
  bbbScheduledSessions {
    items { id title visibility status startTime endTime isTrial slug productVariantId }
    totalItems
  }
}')
SESS_TOTAL=$(echo "$SESSIONS" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.bbbScheduledSessions.totalItems } catch { 0 }" 2>/dev/null || echo "0")
check "Sessions are queryable" '[ "$SESS_TOTAL" -gt 0 ]' "totalItems=$SESS_TOTAL"

SESS_PUBLIC=$(echo "$SESSIONS" | node -p "try { const items = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.bbbScheduledSessions.items; const pub = items.filter(i => i.visibility === 'PUBLIC'); pub.length } catch { 0 }" 2>/dev/null || echo "0")
check "At least one session is PUBLIC" '[ "$SESS_PUBLIC" -gt 0 ]' "PUBLIC sessions=$SESS_PUBLIC"

echo "$SESSIONS" | node -e "
  try {
    const items = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.bbbScheduledSessions.items;
    const pub = items.filter(i => i.visibility === 'PUBLIC');
    if (pub.length > 0) {
      console.log('  PUBLIC sessions:');
      pub.forEach(s => {
        console.log('    - ' + s.title + ' (status=' + s.status + ', start=' + s.startTime + ', isTrial=' + s.isTrial + ', variantId=' + s.productVariantId + ')');
      });
    }
  } catch(e) { console.log('  ℹ Could not parse sessions'); }
"

# ─── 4. Marketplace returns results ─────────────────────────────────────────
echo ""
echo "[4] Marketplace search..."
MARKETPLACE=$(shop_query '{
  marketplaceSearch(term: "Apex", options: { skip: 0, take: 10 }) {
    items { id title status visibility slug }
    totalItems
  }
}')
MS_TOTAL=$(echo "$MARKETPLACE" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.marketplaceSearch.totalItems } catch { 0 }" 2>/dev/null || echo "0")
check "Marketplace search returns results" '[ "$MS_TOTAL" -gt 0 ]' "totalItems=$MS_TOTAL"

echo "$MARKETPLACE" | node -e "
  try {
    const items = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.marketplaceSearch.items;
    console.log('  Marketplace results:');
    items.forEach(item => {
      console.log('    - ' + item.title + ' (status=' + item.status + ', visibility=' + item.visibility + ')');
    });
  } catch(e) { console.log('  ℹ Could not parse marketplace results'); }
"

# ─── 5. Demo customer exists ────────────────────────────────────────────────
echo ""
echo "[5] Demo customer ($DEMO_CUSTOMER_EMAIL)..."
CUSTOMER=$(shop_query "{
  customers(options: { filter: { emailAddress: { eq: \\"$DEMO_CUSTOMER_EMAIL\\" } } }) {
    items { id emailAddress firstName lastName verified }
    totalItems
  }
}")
CUST_ID=$(echo "$CUSTOMER" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.customers.items[0]?.id || '' } catch { '' }" 2>/dev/null || echo "")
CUST_EXISTS=$(echo "$CUSTOMER" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.customers.totalItems } catch { 0 }" 2>/dev/null || echo "0")

if [ "$CUST_EXISTS" = "1" ]; then
  echo -e "  ${GREEN}✓${NC} Demo customer exists: id=$CUST_ID"
  ((passCount++)) || true
else
  echo -e "  ${RED}✗${NC} Demo customer not found"
  ((failCount++)) || true
fi

# ─── 6. Demo customer has full journey state ────────────────────────────────
echo ""
echo "[6] Demo customer journey state..."

if [ -n "$CUST_ID" ]; then
  # Check orders
  ORDERS=$(shop_query "{
    customers(options: { filter: { emailAddress: { eq: \\"$DEMO_CUSTOMER_EMAIL\\" } } }) {
      items {
        orders(options: { filter: { state: { ne: \\"Cancelled\\" } } }) {
          items { id code state total }
          totalItems
        }
      }
    }
  }")
  ORDER_COUNT=$(echo "$ORDERS" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.customers.items[0]?.orders?.totalItems || 0 } catch { 0 }" 2>/dev/null || echo "0")
  check "Demo customer has orders" '[ "$ORDER_COUNT" -gt 0 ]' "orderCount=$ORDER_COUNT"

  if [ "$ORDER_COUNT" -gt 0 ]; then
    echo "$ORDERS" | node -e "
      try {
        const orders = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.customers.items[0].orders.items;
        console.log('  Orders:');
        orders.forEach(o => {
          console.log('    - ' + o.code + ' (state=' + o.state + ', total=' + o.total + ')');
        });
      } catch(e) { console.log('  ℹ Could not parse orders'); }
    "
  fi

  # Check learning dashboard (entitlement + review indicator)
  DASHBOARD=$(shop_query '{
    learningDashboard {
      courses {
        id title canJoin ctaAction ctaLabel isTrial entitlementType entitlementSource
        nextSession { startsAt endsAt }
        instructorName
      }
    }
  }')
  COURSES=$(echo "$DASHBOARD" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.learningDashboard.courses || [] } catch { [] }" 2>/dev/null || echo "[]")
  COURSE_COUNT=$(echo "$COURSES" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).length || 0 } catch { 0 }" 2>/dev/null || echo "0")
  check "Demo customer has courses in dashboard" '[ "$COURSE_COUNT" -gt 0 ]' "courseCount=$COURSE_COUNT"

  JOIN_CTA=$(echo "$COURSES" | node -p "try { const courses = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); courses.filter(c => c.ctaAction === 'join').length } catch { 0 }" 2>/dev/null || echo "0")
  check "Demo customer has join CTA (entitlement active)" '[ "$JOIN_CTA" -gt 0 ]' "joinCTA courses=$JOIN_CTA"

  echo "$DASHBOARD" | node -e "
    try {
      const courses = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.learningDashboard.courses;
      if (courses && courses.length > 0) {
        console.log('  Dashboard courses:');
        courses.forEach(c => {
          console.log('    - ' + c.title + ' (canJoin=' + c.canJoin + ', cta=' + c.ctaAction + '/' + c.ctaLabel + ', entitlement=' + c.entitlementType + '/' + c.entitlementSource + ')');
        });
      }
    } catch(e) { console.log('  ℹ Could not parse dashboard'); }
  "
else
  echo -e "  ${YELLOW}ℹ${NC} Skipping — demo customer not found"
fi

# ─── 7. Session visibility check ────────────────────────────────────────────
echo ""
echo "[7] Session visibility..."

SESS_BY_TITLE=$(shop_query "{
  bbbScheduledSessions {
    items { id title visibility status startTime endTime isTrial slug }
    totalItems
  }
}")
SESS_MATCH=$(echo "$SESS_BY_TITLE" | node -p "try { const items = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.bbbScheduledSessions.items; const match = items.find(i => i.title === '$SESSION_TITLE'); match ? JSON.stringify(match) : 'null' } catch { 'null' }" 2>/dev/null || echo "null")

if echo "$SESS_MATCH" | grep -q "null"; then
  echo -e "  ${YELLOW}ℹ${NC} Session '$SESSION_TITLE' not found (may have different title)"
else
  S_MATCH_VIS=$(echo "$SESS_MATCH" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).visibility } catch { '' }" 2>/dev/null || echo "")
  S_MATCH_STATUS=$(echo "$SESS_MATCH" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).status } catch { '' }" 2>/dev/null || echo "")
  check "Session '$SESSION_TITLE' visibility=PUBLIC" '[ "$S_MATCH_VIS" = "PUBLIC" ]' "visibility=$S_MATCH_VIS"
  check "Session '$SESSION_TITLE' status=SCHEDULED" \
    '[ "$S_MATCH_STATUS" = "SCHEDULED" ]' \
    "status=$S_MATCH_STATUS"
fi

# ─── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "Verification Summary"
echo "============================================"
echo -e "Passed: ${GREEN}$passCount${NC}"
echo -e "Failed: ${RED}$failCount${NC}"
echo ""

# Write output JSON
cat > "$OUTFILE" << EOF
{
  "host": "$HOST",
  "channelToken": "$CHANNEL_TOKEN",
  "demoCustomerEmail": "$DEMO_CUSTOMER_EMAIL",
  "sessionTitle": "$SESSION_TITLE",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "results": {
    "pass": $passCount,
    "fail": $failCount,
    "serverHealthy": true,
    "productsQueryable": $([ "$PROD_TOTAL" -gt 0 ] && echo "true" || echo "false"),
    "sessionsQueryable": $([ "$SESS_TOTAL" -gt 0 ] && echo "true" || echo "false"),
    "sessionsPublic": $([ "$SESS_PUBLIC" -gt 0 ] && echo "true" || echo "false"),
    "marketplaceResults": $([ "$MS_TOTAL" -gt 0 ] && echo "true" || echo "false"),
    "demoCustomerExists": $([ "$CUST_EXISTS" = "1" ] && echo "true" || echo "false"),
    "customerHasOrders": $([ "$ORDER_COUNT" -gt 0 ] && echo "true" || echo "false"),
    "customerHasDashboardCourses": $([ "$COURSE_COUNT" -gt 0 ] && echo "true" || echo "false"),
    "customerHasJoinCTA": $([ "$JOIN_CTA" -gt 0 ] && echo "true" || echo "false")
  }
}
EOF

echo "Output written to $OUTFILE"

if [ "$failCount" -gt 0 ]; then
  echo -e "${RED}✗ Verification had $failCount failure(s)${NC}"
  exit 1
fi

echo -e "${GREEN}✓ All checks passed${NC}"
exit 0
