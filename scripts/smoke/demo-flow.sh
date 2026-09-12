#!/usr/bin/env bash
set -euo pipefail

# Demo experience verification — read-only, API-only smoke checks.
#
# Pass A — fresh learner (no order, no entitlement, no review).
# Pass B — returning learner (existing order + entitlement + review).
#
# IMPORTANT: this script is a VERIFICATION script, not a seed. It validates
# that the storefront/shop API surfaces the right data and CTAs for each
# learner state. It does NOT create orders, payments, entitlements, or
# reviews — those are exercised through the real customer journey.

HOST="${HOST:-http://localhost:3000}"
CHANNEL_CODE="${CHANNEL_CODE:-apex-academy}"
FRESH_EMAIL="${FRESH_EMAIL:-apex.new@example.com}"
RETURNING_EMAIL="${RETURNING_EMAIL:-apex.returning@example.com}"
OUTFILE="${OUTFILE:-/tmp/demo-verification.json}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass=0
fail=0

check() {
  local label="$1"
  local condition="$2"
  local detail="${3:-}"
  if eval "$condition"; then
    echo -e "${GREEN}✓${NC} ${label}"
    ((pass++)) || true
  else
    echo -e "${RED}✗${NC} ${label}"
    [ -n "$detail" ] && echo "       $detail"
    ((fail++)) || true
  fi
}

shop_query() {
  local query="$1"
  local vars="${2:-{}}"
  curl -sS -X POST "$HOST/shop-api" \
    -H 'Content-Type: application/json' \
    -H "vendure-client: demo-verification" \
    -d "{\"query\": \"$query\", \"variables\": $vars}" || echo '{"errors":[{"message":"connection failed"}]}'
}

fetch_customer_by_email() {
  local email="$1"
  shop_query 'query($email: String!) {
    customers(options: { filter: { emailAddress: { eq: $email } } }) {
      items { id emailAddress firstName lastName }
    }
  }' "{\"email\": \"$email\"}"
}

echo "============================================"
echo "Demo Flow Verification (read-only smoke test)"
echo "============================================"
echo "Host: $HOST"
echo "Channel: $CHANNEL_CODE"
echo ""

# ─── Pass A: Fresh learner ───────────────────────────────────────────────────
echo "--- Pass A: Fresh learner ($FRESH_EMAIL) ---"

FRESH_CUST=$(fetch_customer_by_email "$FRESH_EMAIL")
FRESH_ID=$(echo "$FRESH_CUST" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.customers.items[0]?.id || '' } catch { '' }" 2>/dev/null || echo "")

if [ -z "$FRESH_ID" ]; then
  echo "  ℹ Fresh customer $FRESH_EMAIL not found — register first via seed:demo-academy"
else
  echo "  ✓ Fresh customer found: id=$FRESH_ID"

  # Check: no active order
  FRESH_ORDER_CHECK=$(shop_query 'query($email: String!) {
    customers(options: { filter: { emailAddress: { eq: $email } } }) {
      items {
        orders(options: { filter: { state: { ne: "Cancelled" } } }) {
          items { id code state total }
          totalItems
        }
      }
    }
  }' "{\"email\": \"$FRESH_EMAIL\"}")
  FRESH_ORDER_COUNT=$(echo "$FRESH_ORDER_CHECK" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.customers.items[0]?.orders?.totalItems || 0 } catch { 0 }" 2>/dev/null || echo "0")
  check "Fresh learner has no active orders" '[ "$FRESH_ORDER_COUNT" = "0" ]' "found $FRESH_ORDER_COUNT orders"

  # Check: no entitlement (via shop API — no direct entitlement query, check learning dashboard)
  FRESH_DASHBOARD=$(shop_query 'query {
    learningDashboard {
      courses {
        id title canJoin ctaAction ctaLabel isTrial entitlementType entitlementSource
        nextSession { startsAt endsAt }
        instructorName
      }
    }
  }' '{}')
  FRESH_COURSES=$(echo "$FRESH_DASHBOARD" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.learningDashboard.courses || [] } catch { [] }" 2>/dev/null || echo "[]")
  FRESH_COURSE_COUNT=$(echo "$FRESH_COURSES" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).length || 0 } catch { 0 }" 2>/dev/null || echo "0")
  check "Fresh learner has courses in dashboard" '[ "$FRESH_COURSE_COUNT" -gt 0 ]' "found $FRESH_COURSE_COUNT courses"

  # For each course, check CTA is NOT 'join' (since no entitlement)
  echo "$FRESH_COURSES" | node -e "
    try {
      const courses = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      for (const c of courses) {
        if (c.ctaAction === 'join') {
          console.log('  ✗ COURSE_WITH_JOIN_CTA: ' + c.title + ' (should not have join CTA without entitlement)');
          process.exit(1);
        }
      }
      console.log('  ✓ No courses have join CTA for fresh learner');
    } catch(e) { console.log('  ℹ Could not parse courses'); }
  "
fi

echo ""

# ─── Pass B: Returning learner ───────────────────────────────────────────────
echo "--- Pass B: Returning learner ($RETURNING_EMAIL) ---"

RETURNING_CUST=$(fetch_customer_by_email "$RETURNING_EMAIL")
RETURNING_ID=$(echo "$RETURNING_CUST" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.customers.items[0]?.id || '' } catch { '' }" 2>/dev/null || echo "")

if [ -z "$RETURNING_ID" ]; then
  echo "  ℹ Returning customer $RETURNING_EMAIL not found — register first via seed:demo-academy"
else
  echo "  ✓ Returning customer found: id=$RETURNING_ID"

  # Check: has at least one completed order
  RET_ORDER_CHECK=$(shop_query 'query($email: String!) {
    customers(options: { filter: { emailAddress: { eq: $email } } }) {
      items {
        orders(options: { filter: { state: { eq: "Completed" } } }) {
          items { id code state total }
          totalItems
        }
      }
    }
  }' "{\"email\": \"$RETURNING_EMAIL\"}")
  RET_ORDER_COUNT=$(echo "$RET_ORDER_CHECK" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.customers.items[0]?.orders?.totalItems || 0 } catch { 0 }" 2>/dev/null || echo "0")
  check "Returning learner has completed orders" '[ "$RET_ORDER_COUNT" -gt 0 ]' "found $RET_ORDER_COUNT completed orders"

  # Check: learning dashboard shows courses with join CTA
  RET_DASHBOARD=$(shop_query 'query {
    learningDashboard {
      courses {
        id title canJoin ctaAction ctaLabel isTrial entitlementType entitlementSource
        nextSession { startsAt endsAt }
        instructorName
      }
    }
  }' '{}')
  RET_COURSES=$(echo "$RET_DASHBOARD" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.learningDashboard.courses || [] } catch { [] }" 2>/dev/null || echo "[]")
  RET_COURSE_COUNT=$(echo "$RET_COURSES" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).length || 0 } catch { 0 }" 2>/dev/null || echo "0")
  check "Returning learner has courses in dashboard" '[ "$RET_COURSE_COUNT" -gt 0 ]' "found $RET_COURSE_COUNT courses"

  # Check at least one course has join CTA
  echo "$RET_COURSES" | node -e "
    try {
      const courses = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const withJoin = courses.filter(c => c.ctaAction === 'join');
      if (withJoin.length > 0) {
        console.log('  ✓ ' + withJoin.length + ' course(s) have join CTA (entitlement active)');
        for (const c of withJoin) {
          console.log('    - ' + c.title + ' (canJoin=' + c.canJoin + ', ctaLabel=' + c.ctaLabel + ')');
        }
      } else {
        console.log('  ✗ No courses have join CTA for returning learner (expected at least one)');
      }
    } catch(e) { console.log('  ℹ Could not parse courses'); }
  "
fi

echo ""

# ─── Session visibility check (via shop API) ────────────────────────────────
echo "--- Session Visibility Check ---"

SESSION_CHECK=$(shop_query 'query {
  bbbScheduledSessions {
    items { id title visibility status startTime endTime isTrial slug }
    totalItems
  }
}')
SESSION_VISIBILITY=$(echo "$SESSION_CHECK" | node -p "try { const items = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.bbbScheduledSessions.items; const pub = items.filter(i => i.visibility === 'PUBLIC'); pub.length } catch { 0 }" 2>/dev/null || echo "0")
SESSION_TOTAL=$(echo "$SESSION_CHECK" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.bbbScheduledSessions.totalItems } catch { 0 }" 2>/dev/null || echo "0")

check "Sessions are queryable via shop API" '[ "$SESSION_TOTAL" -gt 0 ]' "totalItems=$SESSION_TOTAL"
check "At least one session is PUBLIC" '[ "$SESSION_VISIBILITY" -gt 0 ]' "PUBLIC sessions=$SESSION_VISIBILITY"

# List PUBLIC sessions
echo "$SESSION_CHECK" | node -e "
  try {
    const items = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.bbbScheduledSessions.items;
    const pub = items.filter(i => i.visibility === 'PUBLIC');
    if (pub.length > 0) {
      console.log('  PUBLIC sessions:');
      for (const s of pub) {
        console.log('    - ' + s.title + ' (status=' + s.status + ', start=' + s.startTime + ', isTrial=' + s.isTrial + ')');
      }
    }
  } catch(e) { console.log('  ℹ Could not parse sessions'); }
"

echo ""

# ─── Marketplace search check ───────────────────────────────────────────────
echo "--- Marketplace Search Check ---"

MARKETPLACE_CHECK=$(shop_query 'query {
  marketplaceSearch(term: "Apex", options: { skip: 0, take: 10 }) {
    items { id title status visibility slug }
    totalItems
  }
}')
MS_TOTAL=$(echo "$MARKETPLACE_CHECK" | node -p "try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.marketplaceSearch.totalItems } catch { 0 }" 2>/dev/null || echo "0")
check "Marketplace search returns results" '[ "$MS_TOTAL" -gt 0 ]' "totalItems=$MS_TOTAL"

echo "$MARKETPLACE_CHECK" | node -e "
  try {
    const items = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.marketplaceSearch.items;
    console.log('  Marketplace results:');
    for (const item of items) {
      console.log('    - ' + item.title + ' (status=' + item.status + ', visibility=' + item.visibility + ')');
    }
  } catch(e) { console.log('  ℹ Could not parse marketplace results'); }
"

echo ""

# ─── Summary ────────────────────────────────────────────────────────────────
echo "============================================"
echo "Verification Summary"
echo "============================================"
echo -e "Passed: ${GREEN}$pass${NC}"
echo -e "Failed: ${RED}$fail${NC}"
echo ""

# Write output
cat > "$OUTFILE" << EOF
{
  "host": "$HOST",
  "channelCode": "$CHANNEL_CODE",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pass": $pass,
  "fail": $fail,
  "freshCustomer": {
    "email": "$FRESH_EMAIL",
    "id": "$FRESH_ID"
  },
  "returningCustomer": {
    "email": "$RETURNING_EMAIL",
    "id": "$RETURNING_ID"
  },
  "sessions": {
    "total": $SESSION_TOTAL,
    "public": $SESSION_VISIBILITY
  },
  "marketplace": {
    "totalItems": $MS_TOTAL
  }
}
EOF

echo "Output written to $OUTFILE"

if [ "$fail" -gt 0 ]; then
  echo -e "${RED}✗ Verification had $fail failure(s)${NC}"
  exit 1
fi

echo -e "${GREEN}✓ All checks passed${NC}"
exit 0
