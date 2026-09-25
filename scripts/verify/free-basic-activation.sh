#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# Free Basic activation acceptance — plan §3.2 / slice 4
#
# Proves the provider-free activation contract against a running server, using
# ONLY the public GraphQL APIs (no psql, no manual DB writes):
#
#   1. every self-serve registered tenant ends up with EXACTLY ONE
#      OrganizationSubscription, status 'active', on the provider-free plan
#   2. NO provider subscription and NO SubscriptionProviderBinding is created
#      (providerMandates total = 0 → no provider call happened)
#   3. currentPeriodStart/currentPeriodEnd stay NULL, so the paid renewal
#      pipeline never picks the row up (F-7) and no billing attempt exists
#   4. the free row does NOT block the paid path (the ADR-044 regression check):
#      the corrected subscribeToPlan guard fires, and
#      changeOrganizationSubscriptionPlan is the supported way out
#
# Usage:
#   HOST=http://localhost:3000 \
#   SUPERADMIN_USERNAME=superadmin SUPERADMIN_PASSWORD=superadmin \
#     bash scripts/verify/free-basic-activation.sh
#
# Optional: RUN_PROVIDER_WIRED=1 additionally exercises the free → paid upgrade,
# which needs a Razorpay test key configured on the server.
###############################################################################

HOST="${HOST:-http://localhost:3000}"
ADMIN_API="${ADMIN_API:-$HOST/admin-api}"
SHOP_API="${SHOP_API:-$HOST/shop-api}"
ADMIN_USER="${SUPERADMIN_USERNAME:-superadmin}"
ADMIN_PASS="${SUPERADMIN_PASSWORD:-superadmin}"
FREE_SLUG="${FREE_PLAN_SLUG:-free-basic}"
RUN_ID="$(date +%s)"
OUTDIR="${OUTDIR:-/tmp/freebasic}"
mkdir -p "$OUTDIR"
# Shared Vendure session cookie jar (admin auth is cookie-based, not bearer).
COOKIE_JAR="$OUTDIR/session.cookies"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
passCount=0; failCount=0; skipCount=0

check() {
  local label="$1" condition="$2" detail="${3:-}"
  if eval "$condition"; then
    echo -e "${GREEN}✓${NC} ${label}"; ((passCount++)) || true
  else
    echo -e "${RED}✗${NC} ${label}"; [ -n "$detail" ] && echo "       $detail"; ((failCount++)) || true
  fi
}
skip() { echo -e "${YELLOW}○ SKIP${NC} $1"; [ -n "${2:-}" ] && echo "       $2"; ((skipCount++)) || true; }

gql() { # gql <file-key> <url> <auth-or-empty> <query> [variables-json]
  local key="$1" url="$2" auth="$3" query="$4"
  # NOTE: do NOT write this as vars="${5:-{}}". Bash terminates a parameter
  # expansion at the FIRST '}', so that form appends a literal '}' to $5 —
  # silently corrupting every request body that carries variables.
  local default_vars='{}'
  local vars="${5:-$default_vars}"
  # Vendure delivers the admin session as a cookie (the login payload's `id` is
  # the USER id, not a bearer token) — so every request must share a cookie jar.
  local args=(-sS -X POST "$url" -H "Content-Type: application/json"
              -b "$COOKIE_JAR" -c "$COOKIE_JAR")
  [ -n "$auth" ] && args+=(-H "$auth")
  args+=(-d "$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1],"variables":json.loads(sys.argv[2])}))' "$query" "$vars")")
  curl "${args[@]}" > "$OUTDIR/$key.json"
}
jget() { python3 -c "import json,sys
d=json.load(open(sys.argv[1]))
def dig(o,path):
    for p in path.split('.'):
        if o is None: return None
        o = o[int(p)] if p.isdigit() and isinstance(o,list) else o.get(p) if isinstance(o,dict) else None
    return o
print(json.dumps(dig(d, sys.argv[2])))" "$1" "$2"; }

echo "=== 0. Admin login (Vendure session cookie) ==="
gql login "$ADMIN_API" "" \
  'mutation($u:String!,$p:String!){ login(username:$u,password:$p){ ... on CurrentUser { id identifier } } }' \
  "{\"u\":\"$ADMIN_USER\",\"p\":\"$ADMIN_PASS\"}"
check "admin login succeeded" "! grep -q '\"errors\"' '$OUTDIR/login.json' && grep -q '\"login\"' '$OUTDIR/login.json'" "see $OUTDIR/login.json"
check "session cookie captured" "[ -s \"$COOKIE_JAR\" ]" "the admin API is session-cookie authenticated"
# Fail fast on auth: every later assertion assumes SuperAdmin visibility, so a
# silent auth failure would otherwise masquerade as a slice-4 defect.
gql authcheck "$ADMIN_API" "" 'query{ subscriptionPlans{ id } }'
check "session is authorized for SuperAdmin-only queries" \
  "grep -q 'subscriptionPlans' '$OUTDIR/authcheck.json'" "see $OUTDIR/authcheck.json"
AUTH=""

echo "=== 1. Ensure the provider-free free plan exists (idempotent) ==="
gql plans "$ADMIN_API" "$AUTH" \
  'query{ subscriptionPlans{ id slug name monthlyPriceInPaise providerPlanId isActive } }'
FREE_PLAN_ID=$(python3 -c "
import json
d=json.load(open('$OUTDIR/plans.json'))
plans=(d.get('data') or {}).get('subscriptionPlans') or []
m=[p for p in plans if p['slug']=='$FREE_SLUG']
print(m[0]['id'] if m else '')")
if [ -z "$FREE_PLAN_ID" ]; then
  echo "     no '$FREE_SLUG' plan found — creating it (providerPlanId left NULL)"
  gql mkfree "$ADMIN_API" "$AUTH" \
    'mutation($i:SubscriptionPlanInput!){ createSubscriptionPlan(input:$i){ id slug providerPlanId isActive } }' \
    "{\"i\":{\"name\":\"Free Basic\",\"slug\":\"$FREE_SLUG\",\"description\":\"Provider-free entry tier\",\"monthlyPriceInPaise\":0,\"includedBbbMinutes\":0,\"isActive\":true,\"sortOrder\":0}}"
  FREE_PLAN_ID=$(jget "$OUTDIR/mkfree.json" "data.createSubscriptionPlan.id"); FREE_PLAN_ID="${FREE_PLAN_ID//\"/}"
fi
check "free plan '$FREE_SLUG' exists" "[ -n \"$FREE_PLAN_ID\" ] && [ \"$FREE_PLAN_ID\" != \"null\" ]" "id=$FREE_PLAN_ID"
# Resolve providerPlanId from whichever source actually created/found the plan:
# mkfree.json when we created it in this run, otherwise the catalogue query.
if [ -f "$OUTDIR/mkfree.json" ]; then
  FREE_PP=$(jget "$OUTDIR/mkfree.json" "data.createSubscriptionPlan.providerPlanId")
else
  FREE_PP=$(python3 -c "import json;d=json.load(open('$OUTDIR/plans.json'));p=[x for x in d['data']['subscriptionPlans'] if x['slug']=='$FREE_SLUG'];print(p[0]['providerPlanId'] if p else 'MISSING')")
fi
check "free plan is provider-free (providerPlanId IS NULL)" \
  "{ [ \"$FREE_PP\" = 'null' ] || [ \"$FREE_PP\" = 'None' ]; }" \
  "got $FREE_PP - a providerPlanId here makes provisioning refuse (by design)"

echo "=== 2. Ensure the free-tier capacity policy row exists (5/5/5 + 1 concurrent, §3.6 freeze) ==="
gql mkpolicy "$ADMIN_API" "$AUTH" \
  'mutation($i:PlatformCapacityPolicyInput!){ upsertPlatformCapacityPolicy(input:$i){ id subscriptionPlanId defaultRoomCapacity maxRoomCapacity maxConcurrentParticipants maxConcurrentMeetings } }' \
  "{\"i\":{\"subscriptionPlanId\":\"$FREE_PLAN_ID\",\"defaultRoomCapacity\":5,\"maxRoomCapacity\":5,\"maxConcurrentParticipants\":5,\"maxConcurrentMeetings\":1}}"
POLICY_ROOM=$(jget "$OUTDIR/mkpolicy.json" "data.upsertPlatformCapacityPolicy.defaultRoomCapacity")
check "free-tier policy row upserted at 5/5/5" "[ \"$POLICY_ROOM\" = '5' ]" "defaultRoomCapacity=$POLICY_ROOM (see $OUTDIR/mkpolicy.json)"
POLICY_CONC=$(jget "$OUTDIR/mkpolicy.json" "data.upsertPlatformCapacityPolicy.maxConcurrentMeetings")
check "free-tier concurrent ceiling = 1 (§3.6 freeze; the 5/5/5 triple is participants only)" \
  "[ \"$POLICY_CONC\" = '1' ]" "maxConcurrentMeetings=$POLICY_CONC (see $OUTDIR/mkpolicy.json)"

echo "=== 3. Register a tenant (shop API) → Free Basic must be provisioned ==="
gql register "$SHOP_API" "" \
  'mutation($i:RegisterTenantInput!){ registerNewTenant(input:$i){ channelId channelToken administratorId } }' \
  "{\"i\":{\"businessName\":\"FreeBasic Tenant $RUN_ID\",\"firstName\":\"Free\",\"lastName\":\"Basic\",\"emailAddress\":\"freebasic-$RUN_ID@example.com\",\"password\":\"Test-Passw0rd!\"}}"
CH=$(jget "$OUTDIR/register.json" "data.registerNewTenant.channelId"); CH="${CH//\"/}"
check "tenant registered (channelId present)" "[ -n \"$CH\" ] && [ \"$CH\" != \"null\" ]" "see $OUTDIR/register.json"

# TenantRegisteredEvent is dispatched during registration and the listener writes
# in its own transaction; give it a beat before asserting.
sleep 3

echo "=== 4. Exactly one subscription: active, provider-free, NULL period ==="
gql subs "$ADMIN_API" "$AUTH" \
  'query{ organizationSubscriptions{ id channelId status currentPeriodStart currentPeriodEnd cancelAtPeriodEnd plan{ slug providerPlanId } } }'
python3 - > "$OUTDIR/assert-subs.txt" <<PY
import json
d = json.load(open("$OUTDIR/subs.json"))
rows = [s for s in ((d.get("data") or {}).get("organizationSubscriptions") or [])
        if str(s["channelId"]) == "$CH"]
print("COUNT=%d" % len(rows))
if rows:
    s = rows[0]
    print("STATUS=%s" % s["status"])
    print("PLAN_SLUG=%s" % s["plan"]["slug"])
    print("PLAN_PROVIDER=%s" % s["plan"]["providerPlanId"])
    print("PERIOD_START=%s" % s["currentPeriodStart"])
    print("PERIOD_END=%s" % s["currentPeriodEnd"])
    print("CANCEL_ATE=%s" % s["cancelAtPeriodEnd"])
PY
sed 's/^/       /' "$OUTDIR/assert-subs.txt"
val() { grep -m1 "^$1=" "$OUTDIR/assert-subs.txt" | cut -d= -f2-; }
check "exactly ONE subscription row for the channel" "[ \"$(val COUNT)\" = '1' ]" "got $(val COUNT) row(s)"
check "status = active (provider-free local activation)" "[ \"$(val STATUS)\" = 'active' ]" "got $(val STATUS)"
check "plan = $FREE_SLUG" "[ \"$(val PLAN_SLUG)\" = '$FREE_SLUG' ]" "got $(val PLAN_SLUG)"
check "plan is provider-free (providerPlanId IS NULL)" "[ \"$(val PLAN_PROVIDER)\" = 'None' ]" "got $(val PLAN_PROVIDER)"
check "currentPeriodStart is NULL (F-7)" "[ \"$(val PERIOD_START)\" = 'None' ]" "got $(val PERIOD_START)"
check "currentPeriodEnd is NULL (F-7)" "[ \"$(val PERIOD_END)\" = 'None' ]" "got $(val PERIOD_END)"
check "cancelAtPeriodEnd = false" "[ \"$(val CANCEL_ATE)\" = 'False' ]" "got $(val CANCEL_ATE)"

echo "=== 5. No provider subscription and no binding (proves no provider call) ==="
gql mandates "$ADMIN_API" "$AUTH" \
  'query($c:String!){ providerMandates(channelId:$c){ total items{ id active } } }' "{\"c\":\"$CH\"}"
check "providerMandates total = 0" \
  "[ \"$(jget "$OUTDIR/mandates.json" "data.providerMandates.total")\" = '0' ]" \
  "got $(jget "$OUTDIR/mandates.json" "data.providerMandates.total")"

echo "=== 6. F-7: no billing attempt exists for the free row ==="
gql attempts "$ADMIN_API" "$AUTH" \
  'query($c:String!){ providerPaymentAttempts(channelId:$c){ total } }' "{\"c\":\"$CH\"}"
check "providerPaymentAttempts total = 0" \
  "[ \"$(jget "$OUTDIR/attempts.json" "data.providerPaymentAttempts.total")\" = '0' ]" \
  "got $(jget "$OUTDIR/attempts.json" "data.providerPaymentAttempts.total")"

echo "=== 6b. Plan-derived concurrency converged onto the organization (ADR-031 amendment) ==="
# Why this can't be asserted from the registration response: the organisation is
# created by BbbTenantProvisioningListener, and this BBB plugin is registered
# BEFORE the subscription plugin, so at creation time the free-plan subscription
# row does not exist yet and the plan-matched (Tier 2) policy cannot resolve —
# the organisation starts at the column default. FreePlanProvisioningService
# therefore ANNOUNCES the activation (SubscriptionPlanChangedEvent) and
# BbbSubscriptionListener converges the cache afterwards. Convergence is
# EVENTUAL by design (the announce is fire-and-forget), so POLL instead of
# sampling one instant.
gql effpolicy "$ADMIN_API" "$AUTH" \
  'query($c:ID!){ effectiveCapacityPolicy(channelId:$c){ defaultRoomCapacity maxRoomCapacity maxConcurrentParticipants maxConcurrentMeetings source } }' \
  "{\"c\":\"$CH\"}"
EFF_SOURCE=$(jget "$OUTDIR/effpolicy.json" "data.effectiveCapacityPolicy.source"); EFF_SOURCE="${EFF_SOURCE//\"/}"
EFF_CONC=$(jget "$OUTDIR/effpolicy.json" "data.effectiveCapacityPolicy.maxConcurrentMeetings")
check "effective policy for the channel resolves to the plan tier (source=plan)" \
  "[ \"$EFF_SOURCE\" = 'plan' ]" "got source=$EFF_SOURCE (see $OUTDIR/effpolicy.json)"
check "effective policy maxConcurrentMeetings = 1" "[ \"$EFF_CONC\" = '1' ]" "got $EFF_CONC"

org_limit() { python3 -c "
import json
d = json.load(open('$OUTDIR/orgs.json'))
items = ((d.get('data') or {}).get('bbbOrganizations') or {}).get('items') or []
rows = [o for o in items if str(o['channelId']) == '$CH']
print(rows[0]['concurrentMeetingLimit'] if rows else '')"; }
for attempt in $(seq 1 10); do
  gql orgs "$ADMIN_API" "$AUTH" \
    'query{ bbbOrganizations{ items{ id channelId slug concurrentMeetingLimit } totalItems } }'
  ORG_LIMIT=$(org_limit)
  [ "$ORG_LIMIT" = '1' ] && break
  sleep 1
done
ORG_COUNT=$(python3 -c "
import json
d = json.load(open('$OUTDIR/orgs.json'))
items = ((d.get('data') or {}).get('bbbOrganizations') or {}).get('items') or []
print(len([o for o in items if str(o['channelId']) == '$CH']))")
check "exactly ONE organization exists for the channel" "[ \"$ORG_COUNT\" = '1' ]" "got $ORG_COUNT"
check "org.concurrentMeetingLimit = 1 (Free Basic frozen ceiling, derived from the plan policy)" \
  "[ \"$ORG_LIMIT\" = '1' ]" \
  "got $ORG_LIMIT after polling; expected the plan-derived 1. See $OUTDIR/orgs.json — a value of 5 means the plan-derived sync never ran (event missed AND no startup reconciliation)."

echo "=== 7. The free row does NOT block the paid path (ADR-044 regression check) ==="
gql subblocked "$ADMIN_API" "$AUTH" \
  'mutation($c:String!,$p:ID!){ subscribeToPlan(channelId:$c,planId:$p){ id status } }' \
  "{\"c\":\"$CH\",\"p\":\"$FREE_PLAN_ID\"}"
BLOCK_MSG=$(jget "$OUTDIR/subblocked.json" "errors.0.message"); BLOCK_MSG="${BLOCK_MSG//\"/}"
check "subscribeToPlan is refused with the ADR-044 guard message" \
  "echo \"$BLOCK_MSG\" | grep -q 'non-cancelled subscription'" "see $OUTDIR/subblocked.json"
check "guard names the real condition (non-cancelled), not 'active or trialing'" \
  "echo \"$BLOCK_MSG\" | grep -q 'non-cancelled subscription'" "got: $BLOCK_MSG"
check "guard points at the supported ways out" \
  "echo \"$BLOCK_MSG\" | grep -q 'changeOrganizationSubscriptionPlan'" "got: $BLOCK_MSG"

if [ "${RUN_PROVIDER_WIRED:-0}" = "1" ] && [ -n "${RAZORPAY_TEST_PLAN_ID:-}" ]; then
  echo "=== 8. free -> paid via changeOrganizationSubscriptionPlan (provider-wired) ==="
  gql mkpaid "$ADMIN_API" "$AUTH" \
    'mutation($i:SubscriptionPlanInput!){ createSubscriptionPlan(input:$i){ id slug providerPlanId } }' \
    "{\"i\":{\"name\":\"Slice4 Paid $RUN_ID\",\"slug\":\"slice4-paid-$RUN_ID\",\"monthlyPriceInPaise\":49000,\"providerPlanId\":\"$RAZORPAY_TEST_PLAN_ID\"}}"
  PAID_ID=$(jget "$OUTDIR/mkpaid.json" "data.createSubscriptionPlan.id"); PAID_ID="${PAID_ID//\"/}"
  gql upgrade "$ADMIN_API" "$AUTH" \
    'mutation($c:String!,$p:ID!){ changeOrganizationSubscriptionPlan(channelId:$c,planId:$p){ id status plan{ slug } } }' \
    "{\"c\":\"$CH\",\"p\":\"$PAID_ID\"}"
  UP_STATUS=$(jget "$OUTDIR/upgrade.json" "data.changeOrganizationSubscriptionPlan.status")
  check "free row upgraded to the paid plan (supersede in place)" "[ \"$UP_STATUS\" = '\"pending_provider_auth\"' ]" "got $UP_STATUS (see $OUTDIR/upgrade.json)"
else
  skip "free -> paid upgrade (changeOrganizationSubscriptionPlan)" "set RUN_PROVIDER_WIRED=1 and RAZORPAY_TEST_PLAN_ID=<razorpay plan_id> with a test key configured. The mechanism is covered by scripts/verify/adr-044-acceptance.sh scenario 4."
fi

echo "=== 9. Duplicate delivery on the SAME channel is a no-op ==="
skip "second provisioning attempt for the same channel" "TenantRegisteredEvent is published by TenantProfileService.create() and cannot be replayed for a channel that already has a profile - no Admin mutation re-publishes it. Coverage instead: scenario 4 asserts exactly one row for a real registration, and the service re-checks inside its transaction with the partial unique index as the DB backstop (a lost race adopts the winner's row). Manual: re-publish the event from a dev hook and re-run scenario 4 - COUNT must stay 1."

echo "=== 10. Renewal sweep must not discover the free row (F-7 runtime proof) ==="
skip "processRenewals() enqueues nothing for the free channel" "The sweep is scheduler-driven and not triggerable over GraphQL. With a dev DB: run the 'subscription-renewal' scheduled task, then confirm no new SubscriptionBillingAttempt row and no renewal log line naming this channel. Scenario 6 asserts the DB-visible precondition (zero attempts + NULL currentPeriodEnd)."

echo
echo "=== Summary ==="
echo -e "  ${GREEN}passed: $passCount${NC}   ${RED}failed: $failCount${NC}   ${YELLOW}skipped: $skipCount${NC}"
echo "  channel under test: $CH   free plan: $FREE_PLAN_ID ($FREE_SLUG)"
echo "  raw responses: $OUTDIR/"
[ "$failCount" -eq 0 ] || exit 1
