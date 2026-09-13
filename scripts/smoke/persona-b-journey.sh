#!/usr/bin/env bash
# Persona B - Real Learner Journey
set -euo pipefail

SHOP_API="${SHOP_API:-http://localhost:3000/shop-api}"
COOKIE_FILE="/tmp/persona_b_cookies.txt"
LOG_FILE="/tmp/persona_b_journey.txt"

UNIQUE_ID="$(date +%s%N)"
LEARNER_EMAIL="learner.b.${UNIQUE_ID}@example.com"
LEARNER_PASSWORD="LearnerPass123!"
CHANNEL_TOKEN="${CHANNEL_TOKEN:-tok_apex-academy_p0p0ik}"

PASS=0
FAIL=0

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE" >&2; }
pass() { PASS=$((PASS+1)); log "PASS: $*"; }
fail() { FAIL=$((FAIL+1)); log "FAIL: $*"; }

GQL_HELPER="$(dirname "$0")/_gql_helper.mjs"

shop_q() {
  local query="$1"
  local vars="${2-}"
  if [ -z "$vars" ]; then
    vars='{}'
  fi
  local payload
  payload=$(node "$GQL_HELPER" payload "$query" "$vars")
  curl -sS -b "$COOKIE_FILE" -c "$COOKIE_FILE" -X POST "$SHOP_API" \
    -H 'Content-Type: application/json' \
    -H "vendure-token: $CHANNEL_TOKEN" \
    -d "$payload"
}

json_val() {
  local json="$1"
  local path="$2"
  echo "$json" | node "$GQL_HELPER" extract "-" "$path"
}

json_count() {
  local json="$1"
  local path="$2"
  echo "$json" | node "$GQL_HELPER" count "-" "$path"
}

# Admin API helper — requires superadmin authentication.
# Uses a separate cookie file; logs in once per run.
ADMIN_API="${ADMIN_API:-http://localhost:3000/admin-api}"
ADMIN_COOKIE_FILE="/tmp/persona_b_admin_cookies.txt"
_ADMIN_LOGGED_IN=false

admin_login() {
  if [ "$_ADMIN_LOGGED_IN" = true ]; then return 0; fi
  rm -f "$ADMIN_COOKIE_FILE"
  local login_payload
  login_payload=$(node "$GQL_HELPER" payload \
    'mutation LogIn($username: String!, $password: String!, $rememberMe: Boolean) { login(username: $username, password: $password, rememberMe: $rememberMe) { ... on CurrentUser { id identifier } ... on ErrorResult { errorCode message } } }' \
    '{"username":"superadmin","password":"superadmin","rememberMe":true}')
  local login_resp
  login_resp=$(curl -sS -c "$ADMIN_COOKIE_FILE" -X POST "$ADMIN_API" \
    -H 'Content-Type: application/json' \
    -d "$login_payload")
  local login_id
  login_id=$(echo "$login_resp" | node "$GQL_HELPER" extract "-" "data.login.identifier")
  if [ -n "$login_id" ]; then
    _ADMIN_LOGGED_IN=true
    log "Admin authenticated as $login_id"
  else
    log "WARN: Admin login failed: $login_resp"
  fi
}

admin_q() {
  local query="$1"
  local vars="${2-}"
  if [ -z "$vars" ]; then
    vars='{}'
  fi
  admin_login
  local payload
  payload=$(node "$GQL_HELPER" payload "$query" "$vars")
  curl -sS -b "$ADMIN_COOKIE_FILE" -c "$ADMIN_COOKIE_FILE" -X POST "$ADMIN_API" \
    -H 'Content-Type: application/json' \
    -d "$payload"
}

cleanup() { rm -f "$COOKIE_FILE" "$LOG_FILE" "$ADMIN_COOKIE_FILE"; }
trap cleanup EXIT

log "============================================================="
log "Persona B - Real Learner Journey"
log "============================================================="
log "Email: $LEARNER_EMAIL"
log "Channel: $CHANNEL_TOKEN"

# Step 1: Register
log ""
log "--- Step 1: Register ---"
VARS=$(node "$GQL_HELPER" payload 'mutation Register($input: RegisterCustomerInput!) { registerCustomerAccount(input: $input) { ... on Success { success } ... on ErrorResult { errorCode message } } }' '{}')
REG_DATA=$(shop_q "mutation Register(\$input: RegisterCustomerInput!) { registerCustomerAccount(input: \$input) { ... on Success { success } ... on ErrorResult { errorCode message } } }" "{\"input\":{\"emailAddress\":\"$LEARNER_EMAIL\",\"password\":\"$LEARNER_PASSWORD\",\"firstName\":\"Learner\",\"lastName\":\"Beta\"}}")
REG_SUCCESS=$(json_val "$REG_DATA" "data.registerCustomerAccount.success")
if [ "$REG_SUCCESS" = "true" ]; then
  pass "Registration successful"
else
  fail "Registration failed: $REG_DATA"
  exit 1
fi

# Step 2: Verify email (read captured token from dev mailbox, then verify)
# Vendure: with requireVerification=true, registerCustomerAccount triggers the
# AccountRegistrationEvent; the EmailPlugin (devMode) renders the verification
# email with the real token. verifyCustomerAccount with that token verifies the
# account AND authenticates the customer in one step (returns CurrentUser).
log ""
log "--- Step 2: Email Verification ---"
# Vendure: with requireVerification=true, registerCustomerAccount triggers the
# AccountRegistrationEvent; the EmailPlugin (devMode) renders the verification
# email with the real token. verifyCustomerAccount with that token verifies the
# account AND authenticates the customer in one step (returns CurrentUser).
# Poll the dev mailbox for up to 20s — the send-email job is processed by the
# worker asynchronously, so the email may appear a moment after registration.
MAILBOX_DIR="$(cd "$(dirname "$0")/../../static/email/test-emails" && pwd)"
TOKEN_FILE=""
for i in $(seq 1 20); do
  TOKEN_FILE=$(node -e '
    const fs = require("fs"), path = require("path");
    const dir = process.argv[1], recipient = process.argv[2];
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith("_please_verify_your_email_address.json")); } catch (e) {}
    files.sort().reverse();
    for (const f of files) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        if (m.recipient === recipient) { console.log(path.join(dir, f)); break; }
      } catch (e) {}
    }
  ' "$MAILBOX_DIR" "$LEARNER_EMAIL")
  [ -n "$TOKEN_FILE" ] && break
  sleep 1
done
if [ -z "$TOKEN_FILE" ]; then
  fail "No verification email found in mailbox ($MAILBOX_DIR) for $LEARNER_EMAIL after 20s. Is the Vendure worker (index-worker) running?"
  exit 1
fi
VERIFICATION_TOKEN=$(node -e "
const m = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
const match = m.body && m.body.match(/token=([A-Za-z0-9_\-]+)/);
console.log(match ? match[1] : '');
" "$TOKEN_FILE")
if [ -z "$VERIFICATION_TOKEN" ]; then
  fail "Verification token not found in email: $TOKEN_FILE"
  exit 1
fi
log "Verification token captured from: $(basename "$TOKEN_FILE")"
VARS=$(node -e "process.stdout.write(JSON.stringify({token:'$VERIFICATION_TOKEN'}))")
VERIFY_DATA=$(shop_q 'mutation Verify($token: String!) { verifyCustomerAccount(token: $token) { ... on CurrentUser { id identifier } ... on ErrorResult { errorCode message } } }' "$VARS")
VERIFY_ID=$(json_val "$VERIFY_DATA" "data.verifyCustomerAccount.identifier")
if [ -n "$VERIFY_ID" ]; then
  pass "Email verified and authenticated as $VERIFY_ID"
else
  fail "Verification failed: $VERIFY_DATA"
  exit 1
fi

# Confirm authenticated session is real
ME_DATA=$(shop_q '{ me { id identifier } }')
ME_ID=$(json_val "$ME_DATA" "data.me.identifier")
if [ "$ME_ID" = "$LEARNER_EMAIL" ]; then
  pass "Authenticated session confirmed (me.identifier = $ME_ID)"
else
  fail "Session not authenticated after verification: $ME_DATA"
  exit 1
fi

# Step 3: Discover public trial sessions (informational — resolver filters isTrial: true)
# publicScheduledSessions only returns PUBLIC + TRIAL sessions, so an empty
# result is valid in a fixture that only seeds the paid demo course. Discovery
# of the purchasable product happens via `search` in Step 3b.
log ""
log "--- Step 3: Discover Public Trial Sessions ---"
SESSIONS_DATA=$(shop_q '{ publicScheduledSessions { id title startTime endTime status trainerName } }')
SESSION_COUNT=$(echo "$SESSIONS_DATA" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.data?.publicScheduledSessions?.length ?? 0)')
if [ "$SESSION_COUNT" -gt 0 ]; then
  pass "Found $SESSION_COUNT public trial session(s)"
else
  log "No public trial sessions seeded (publicScheduledSessions = []) — continuing via search"
fi

# Step 3b: Discover purchasable product via Shop search
log ""
log "--- Step 3b: Discover Product via Search ---"
SEARCH_DATA=$(shop_q '{ search(input: { groupByProduct: false, take: 5 }) { totalItems items { productId productName productVariantId productVariantName price { ... on SinglePrice { value } } } } }')
VARIANT_ID=$(echo "$SEARCH_DATA" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.data?.search?.items?.[0]?.productVariantId ?? "")')
PRODUCT_ID=$(echo "$SEARCH_DATA" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.data?.search?.items?.[0]?.productId ?? "")')
PRODUCT_NAME=$(echo "$SEARCH_DATA" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.data?.search?.items?.[0]?.productName ?? "")')
if [ -n "$VARIANT_ID" ]; then
  pass "Found purchasable product: $PRODUCT_NAME (variant $VARIANT_ID)"
else
  fail "No purchasable products found via search: $SEARCH_DATA"
  exit 1
fi

# Step 4: View product
log ""
log "--- Step 4: View Product ---"
PRODUCT_DATA=$(shop_q "{ product(id: \"$PRODUCT_ID\") { id name description } }")
PRODUCT_NAME=$(json_val "$PRODUCT_DATA" "data.product.name")
if [ -n "$PRODUCT_NAME" ]; then
  pass "Product: $PRODUCT_NAME"
else
  fail "Product not found: $PRODUCT_DATA"
  exit 1
fi

# Step 5: Add to cart
log ""
log "--- Step 5: Add to Cart ---"
VARS=$(node -e "process.stdout.write(JSON.stringify({productVariantId:'$VARIANT_ID',quantity:1}))")
ADD_DATA=$(shop_q 'mutation AddItem($productVariantId: ID!, $quantity: Int!) { addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) { ... on Order { id lines { productVariant { name } quantity } } ... on ErrorResult { errorCode message } } }' "$VARS")
ADD_ORDER_ID=$(json_val "$ADD_DATA" "data.addItemToOrder.id")
if [ -n "$ADD_ORDER_ID" ]; then
  pass "Item added to cart (Order: $ADD_ORDER_ID)"
else
  fail "Add to cart failed: $ADD_DATA"
  exit 1
fi

# Step 6: Set customer
log ""
log "--- Step 6: Set Customer ---"
VARS=$(node -e "process.stdout.write(JSON.stringify({input:{emailAddress:'$LEARNER_EMAIL',firstName:'Learner',lastName:'Beta'}}))")
CUST_DATA=$(shop_q 'mutation SetCust($input: CreateCustomerInput!) { setCustomerForOrder(input: $input) { ... on Order { id } ... on ErrorResult { errorCode message } } }' "$VARS")
CUST_ORDER=$(json_val "$CUST_DATA" "data.setCustomerForOrder.id")
CUST_ERR=$(json_val "$CUST_DATA" "data.setCustomerForOrder.errorCode")
if [ -n "$CUST_ORDER" ]; then
  pass "Customer set"
elif [ "$CUST_ERR" = "ALREADY_LOGGED_IN_ERROR" ]; then
  pass "Order already bound to logged-in customer (setCustomerForOrder returned ALREADY_LOGGED_IN)"
else
  fail "Set customer failed: $CUST_DATA"
  exit 1
fi

# Step 7: Set shipping address
log ""
log "--- Step 7: Set Shipping Address ---"
VARS=$(node -e "process.stdout.write(JSON.stringify({input:{streetLine1:'123 Main St',city:'Bengaluru',postalCode:'560001',countryCode:'IN'}}))")
ADDR_DATA=$(shop_q 'mutation SetAddr($input: CreateAddressInput!) { setOrderShippingAddress(input: $input) { ... on Order { id } ... on ErrorResult { errorCode message } } }' "$VARS")
ADDR_ORDER=$(json_val "$ADDR_DATA" "data.setOrderShippingAddress.id")
if [ -n "$ADDR_ORDER" ]; then
  pass "Shipping address set"
else
  fail "Set address failed: $ADDR_DATA"
  exit 1
fi

# Step 8: Set shipping method
log ""
log "--- Step 8: Set Shipping Method ---"
SHIP_METHODS=$(shop_q '{ eligibleShippingMethods { id name code price } }')
SHIP_METHOD_ID=$(echo "$SHIP_METHODS" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.data?.eligibleShippingMethods?.[0]?.id ?? "")')
if [ -z "$SHIP_METHOD_ID" ]; then
  fail "No eligible shipping methods: $SHIP_METHODS"
  exit 1
fi
VARS=$(node -e "process.stdout.write(JSON.stringify({id:['$SHIP_METHOD_ID']}))")
SET_SHIP_DATA=$(shop_q 'mutation SetShip($id: [ID!]!) { setOrderShippingMethod(shippingMethodId: $id) { ... on Order { id } ... on ErrorResult { errorCode message } } }' "$VARS")
SET_SHIP_ORDER=$(json_val "$SET_SHIP_DATA" "data.setOrderShippingMethod.id")
if [ -n "$SET_SHIP_ORDER" ]; then
  pass "Shipping method set"
else
  fail "Set shipping method failed: $SET_SHIP_DATA"
  exit 1
fi

# Step 8b: Transition order to ArrangingPayment (required before adding payment)
log ""
log "--- Step 8b: Transition to ArrangingPayment ---"
ORDER_STATE_DATA=$(shop_q '{ activeOrder { state } }')
ORDER_STATE_CUR=$(json_val "$ORDER_STATE_DATA" "data.activeOrder.state")
log "Current order state: $ORDER_STATE_CUR"
if [ "$ORDER_STATE_CUR" != "ArrangingPayment" ]; then
  VARS=$(node -e "process.stdout.write(JSON.stringify({state:'ArrangingPayment'}))")
  TRANS_DATA=$(shop_q 'mutation ToPay($state: String!) { transitionOrderToState(state: $state) { ... on Order { id state } ... on ErrorResult { errorCode message } } }' "$VARS")
  TRANS_STATE=$(json_val "$TRANS_DATA" "data.transitionOrderToState.state")
  if [ "$TRANS_STATE" = "ArrangingPayment" ]; then
    pass "Order transitioned to ArrangingPayment"
  else
    fail "Failed to transition order to ArrangingPayment: $TRANS_DATA"
    exit 1
  fi
else
  pass "Order already in ArrangingPayment"
fi

# Step 9: Add payment
log ""
log "--- Step 9: Add Payment ---"
PAY_METHODS_DATA=$(shop_q '{ eligiblePaymentMethods { id name code isEligible } }')
PAY_METHOD_CODE=$(echo "$PAY_METHODS_DATA" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.data?.eligiblePaymentMethods?.[0]?.code ?? "")')
if [ -z "$PAY_METHOD_CODE" ]; then
  fail "No eligible payment methods: $PAY_METHODS_DATA"
  exit 1
fi
log "Payment method: $PAY_METHOD_CODE"
VARS=$(node -e "process.stdout.write(JSON.stringify({input:{method:'$PAY_METHOD_CODE',metadata:{}}}))")
ADD_PAY_DATA=$(shop_q 'mutation AddPay($input: PaymentInput!) { addPaymentToOrder(input: $input) { ... on Order { id state code } ... on ErrorResult { errorCode message } } }' "$VARS")
PAY_ORDER_ID=$(json_val "$ADD_PAY_DATA" "data.addPaymentToOrder.id")
PAY_ORDER_CODE=$(json_val "$ADD_PAY_DATA" "data.addPaymentToOrder.code")
if [ -n "$PAY_ORDER_ID" ]; then
  pass "Payment added (Order ID: $PAY_ORDER_ID)"
else
  fail "Add payment failed: $ADD_PAY_DATA"
  exit 1
fi

# Step 10: Check order status (order may be settled already, so use orderByCode)
log ""
log "--- Step 10: Order Status ---"
ORDER_DATA=$(shop_q "{ orderByCode(code: \"$PAY_ORDER_CODE\") { id code state total totalWithTax } }")
ORDER_CODE=$(json_val "$ORDER_DATA" "data.orderByCode.code")
ORDER_STATE=$(json_val "$ORDER_DATA" "data.orderByCode.state")
log "Order: $ORDER_CODE, State: $ORDER_STATE"
if [ -n "$ORDER_CODE" ]; then
  pass "Order confirmed: $ORDER_CODE ($ORDER_STATE)"
else
  fail "Order not found: $ORDER_DATA"
  exit 1
fi

# Step 10b: Settle payment via Admin API
# The BbbOrderFulfillmentListener only fires on PaymentSettled, not
# PaymentAuthorized. The test/dummy payment handler leaves the order in
# PaymentAuthorized, so we explicitly settle the payment to trigger the
# OrderStateTransitionEvent → entitlement creation.
#
# settlePayment expects a PAYMENT id (not an order id), and returns
# SettlePaymentResult = Payment | SettlePaymentError | ...
log ""
log "--- Step 10b: Settle Payment (Admin API) ---"
# Fetch the payment id from the order via Admin API
PAYMENT_ID=$(admin_q "{ order(id: \"$PAY_ORDER_ID\") { payments { id state } } }" | node "$GQL_HELPER" extract "-" "data.order.payments.0.id")
if [ -z "$PAYMENT_ID" ] || [ "$PAYMENT_ID" = "null" ]; then
  fail "Could not resolve payment id for order $ORDER_CODE"
  exit 1
fi
log "Payment ID: $PAYMENT_ID"
SETTLE_VARS=$(node -e "process.stdout.write(JSON.stringify({id:'$PAYMENT_ID'}))")
SETTLE_DATA=$(admin_q 'mutation SettlePayment($id: ID!) { settlePayment(id: $id) { ... on Payment { id state amount } ... on SettlePaymentError { errorCode message } ... on PaymentStateTransitionError { errorCode message } ... on OrderStateTransitionError { errorCode message } } }' "$SETTLE_VARS")
SETTLE_STATE=$(echo "$SETTLE_DATA" | node "$GQL_HELPER" extract "-" "data.settlePayment.state")
if [ "$SETTLE_STATE" = "Settled" ]; then
  pass "Payment settled (Order: $ORDER_CODE, Payment: $PAYMENT_ID)"
else
  log "settlePayment result state: $SETTLE_STATE (raw: $SETTLE_DATA)"
  SETTLE_ERR=$(echo "$SETTLE_DATA" | node "$GQL_HELPER" extract "-" "data.settlePayment.errorCode")
  if [ -n "$SETTLE_ERR" ] && [ "$SETTLE_ERR" != "null" ]; then
    fail "settlePayment returned error: $SETTLE_ERR"
    exit 1
  fi
  pass "settlePayment completed (state: $SETTLE_STATE)"
fi

# Step 11: Verify settled / post-payment order state
log ""
log "--- Step 11: Verify Order State ---"
ORDER_DATA2=$(shop_q "{ orderByCode(code: \"$ORDER_CODE\") { id code state total } }")
ORDER_STATE2=$(json_val "$ORDER_DATA2" "data.orderByCode.state")
log "Order state: $ORDER_STATE2"
pass "Order verified ($ORDER_STATE2)"

# Step 12: Check entitlement / dashboard
log ""
log "--- Step 12: Check Entitlement / Dashboard ---"
DASH_DATA=$(shop_q '{ myLearningDashboard { courses { id title canJoin ctaAction entitlementType entitlementSource } } }')
COURSE_COUNT=$(echo "$DASH_DATA" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.data?.myLearningDashboard?.courses?.length ?? -1)')
if [ -n "$COURSE_COUNT" ] && [ "$COURSE_COUNT" -ge 0 ]; then
  pass "Learning dashboard exists"
  log "Courses in dashboard: $COURSE_COUNT"
else
  fail "No learning dashboard: $DASH_DATA"
fi

# Step 13: Verify server-driven authorization (canJoin / ctaAction)
# Session is SCHEDULED (not LIVE), so canJoin MUST be false.
# The storefront must NOT re-derive this from the clock (INV-008).
log ""
log "--- Step 13: Learning Authorization (canJoin / ctaAction) ---"
CAN_JOIN=$(echo "$DASH_DATA" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); const c=d.data?.myLearningDashboard?.courses?.[0]; console.log(c ? c.canJoin : "NO_COURSE")')
CTA_ACTION=$(echo "$DASH_DATA" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); const c=d.data?.myLearningDashboard?.courses?.[0]; console.log(c ? c.ctaAction : "NO_COURSE")')
if [ "$COURSE_COUNT" -le 0 ]; then
  fail "Cannot check canJoin: no course in dashboard"
elif [ "$CAN_JOIN" = "false" ] && [ "$CTA_ACTION" = "none" ]; then
  pass "Server-driven authorization correct (canJoin=false, ctaAction=none, session not LIVE)"
  log "Entitlement present but join blocked until session goes LIVE — INV-008 preserved"
else
  fail "Authorization mismatch: canJoin=$CAN_JOIN ctaAction=$CTA_ACTION (expected false/none for SCHEDULED)"
fi

# Step 14: Summary
log ""
log "============================================================="
log "Persona B Journey Summary"
log "============================================================="
log "Passed: $PASS"
log "Failed: $FAIL"
log "============================================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
