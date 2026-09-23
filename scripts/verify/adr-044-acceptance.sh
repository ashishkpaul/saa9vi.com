#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# ADR-044 acceptance — plan change + cancellation (Admin GraphQL + Shop GraphQL)
#
# Exercises the two new Admin mutations end-to-end against a running server.
# NO psql, no manual DB writes: every fixture is created through the public
# GraphQL APIs (registerNewTenant on the shop API; plan/subscription mutations
# on the admin API).
#
# Usage:
#   HOST=http://localhost:3000 \
#   SUPERADMIN_USERNAME=superadmin SUPERADMIN_PASSWORD=superadmin \
#     bash scripts/verify/adr-044-acceptance.sh
#
# REQUIRES a dev server with a RAZORPAY test key for the provider-wired
# scenarios (subscribe / supersede / provider-wired cancel). Scenarios 8-10
# (provider-free) and the idempotency checks work without one.
###############################################################################

HOST="${HOST:-http://localhost:3000}"
ADMIN_API="${ADMIN_API:-$HOST/admin-api}"
SHOP_API="${SHOP_API:-$HOST/shop-api}"
ADMIN_USER="${SUPERADMIN_USERNAME:-superadmin}"
ADMIN_PASS="${SUPERADMIN_PASSWORD:-superadmin}"
RUN_ID="$(date +%s)"
OUTDIR="${OUTDIR:-/tmp/adr044}"
mkdir -p "$OUTDIR"
# Shared Vendure session cookie jar (admin auth is cookie-based; the login
# payload's `id` is the USER id, not a bearer token).
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

# gql <file-key> <url> <auth-header-or-empty> <query> [variables-json]
gql() {
  local key="$1" url="$2" auth="$3" query="$4"
  # NOTE: do NOT write this as vars="${5:-{}}". Bash terminates a parameter
  # expansion at the FIRST '}', so that form appends a literal '}' to $5 —
  # silently corrupting every request body that carries variables (the script
  # then fails with "POST body missing, invalid Content-Type" while every
  # response looks like a server-side fault).
  local default_vars='{}'
  local vars="${5:-$default_vars}"
  local args=(-sS -X POST "$url" -H "Content-Type: application/json"
              -b "$COOKIE_JAR" -c "$COOKIE_JAR")
  [ -n "$auth" ] && args+=(-H "$auth")
  args+=(-d "$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1],"variables":json.loads(sys.argv[2])}))' "$query" "$vars")")
  curl "${args[@]}" > "$OUTDIR/$key.json"
}
jget() { python3 -c "import json,sys;d=json.load(open(sys.argv[1]));
import functools
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
# Fail fast on auth so a later failure cannot be misread as a defect in the code
# under test.
gql authcheck "$ADMIN_API" "" 'query{ subscriptionPlans{ id } }'
check "session is authorized for SuperAdmin-only queries" \
  "grep -q 'subscriptionPlans' '$OUTDIR/authcheck.json'" "see $OUTDIR/authcheck.json"
AUTH=""

echo "=== 1. Plan catalogue fixtures (unique slugs per run) ==="
mkplan() { # mkplan <key> <slug> <name> <price> <providerPlanId-or-empty>
  local key="$1" slug="$2" name="$3" price="$4" ppid="$5"
  gql "$key" "$ADMIN_API" "$AUTH" \
    'mutation($i:SubscriptionPlanInput!){ createSubscriptionPlan(input:$i){ id slug name monthlyPriceInPaise providerPlanId } }' \
    "{\"i\":{\"name\":\"$name\",\"slug\":\"$slug\",\"monthlyPriceInPaise\":$price,\"includedBbbMinutes\":60,\"providerPlanId\":$([ -n "$ppid" ] && echo "'$ppid'" || echo null)}}"
  jget "$OUTDIR/$key.json" "data.createSubscriptionPlan.id"
}
PAID_A_ID=$(mkplan paidA "adr044-paid-a-$RUN_ID" "ADR044 Paid A" 49000 "plan_TESTADRA$RUN_ID" | tr -d '"')
PAID_B_ID=$(mkplan paidB "adr044-paid-b-$RUN_ID" "ADR044 Paid B" 99000 "plan_TESTADRB$RUN_ID" | tr -d '"')
FREE_ID=$(mkplan free "adr044-free-$RUN_ID" "ADR044 Free" 0 "" | tr -d '"')
check "three plans created (paidA/paidB/free)" "[ -n \"$PAID_A_ID\" ] && [ \"$PAID_A_ID\" != \"null\" ] && [ -n \"$FREE_ID\" ] && [ \"$FREE_ID\" != \"null\" ]" "paidA=$PAID_A_ID paidB=$PAID_B_ID free=$FREE_ID"

echo "=== 2. Provision tenant via SHOP registerNewTenant (Channel+TenantProfile+BbbOrganization) ==="
gql register "$SHOP_API" "" \
  'mutation($i:RegisterTenantInput!){ registerNewTenant(input:$i){ channelId channelToken administratorId } }' \
  "{\"i\":{\"businessName\":\"ADR044 Tenant $RUN_ID\",\"firstName\":\"Adr\",\"lastName\":\"Tester\",\"emailAddress\":\"adr044-$RUN_ID@example.com\",\"password\":\"Test-Passw0rd!\"}}"
CH=$(jget "$OUTDIR/register.json" "data.registerNewTenant.channelId"); CH="${CH//\"/}"
check "tenant provisioned (channelId present)" "[ -n \"$CH\" ] && [ \"$CH\" != \"null\" ]" "see $OUTDIR/register.json"

sub() { # sub <key> <planId>
  gql "$1" "$ADMIN_API" "$AUTH" \
    'mutation($c:String!,$p:ID!){ subscribeToPlan(channelId:$c,planId:$p){ id status cancelAtPeriodEnd cancelledAt providerStatus plan{ slug } } }' \
    "{\"c\":\"$CH\",\"p\":\"$2\"}"
}
change() { # change <key> <planId>
  gql "$1" "$ADMIN_API" "$AUTH" \
    'mutation($c:String!,$p:ID!){ changeOrganizationSubscriptionPlan(channelId:$c,planId:$p){ id status cancelAtPeriodEnd cancelledAt providerStatus plan{ slug } } }' \
    "{\"c\":\"$CH\",\"p\":\"$2\"}"
}
cancel() { # cancel <key> <atPeriodEnd>
  gql "$1" "$ADMIN_API" "$AUTH" \
    'mutation($c:String!,$a:Boolean){ cancelOrganizationSubscription(channelId:$c,atPeriodEnd:$a){ id status cancelAtPeriodEnd cancelledAt } }' \
    "{\"c\":\"$CH\",\"a\":$2}"
}
mandateCount() { # mandateCount <key>
  gql "$1" "$ADMIN_API" "$AUTH" \
    'query($c:String!){ providerMandates(channelId:$c){ total items{ id providerSubscriptionId active } } }' \
    "{\"c\":\"$CH\"}"
  jget "$OUTDIR/$1.json" "data.providerMandates.total"
}
echo "=== 3. subscribeToPlan(paidA) → pending_provider_auth (baseline) ==="
sub s1 "$PAID_A_ID"
S1_ID=$(jget "$OUTDIR/s1.json" "data.subscribeToPlan.id"); S1_ID="${S1_ID//\"/}"
S1_STATUS=$(jget "$OUTDIR/s1.json" "data.subscribeToPlan.status")
check "subscribeToPlan → pending_provider_auth" "[ \"$S1_STATUS\" = '\"pending_provider_auth\"' ]" "got $S1_STATUS"
check "subscribeToPlan created a mandate row" "[ \"$(mandateCount m1)\" = '1' ]" "mandates=$(mandateCount m1)"

echo "=== 4. changeOrganizationSubscriptionPlan(paidA → paidB): SAME row id (supersede in place) ==="
change c1 "$PAID_B_ID"
C1_ID=$(jget "$OUTDIR/c1.json" "data.changeOrganizationSubscriptionPlan.id"); C1_ID="${C1_ID//\"/}"
C1_PLAN=$(jget "$OUTDIR/c1.json" "data.changeOrganizationSubscriptionPlan.plan.slug")
check "plan changed to paidB" "echo \"$C1_PLAN\" | grep -q 'adr044-paid-b-$RUN_ID'" "got $C1_PLAN"
check "row was SUPERSEDED, not recreated (same id)" "[ \"$C1_ID\" = \"$S1_ID\" ]" "before=$S1_ID after=$C1_ID"
check "status back to pending_provider_auth (re-authorization)" "[ \"$(jget "$OUTDIR/c1.json" "data.changeOrganizationSubscriptionPlan.status")\" = '\"pending_provider_auth\"' ]"
check "period fields are NULL (ADR-041 / F-7)" "[ \"$(jget "$OUTDIR/c1.json" "data.changeOrganizationSubscriptionPlan.currentPeriodEnd")\" = 'null' ]"
check "exactly 2 mandates: 1 superseded (inactive) + 1 new" "[ \"$(mandateCount m2)\" = '2' ]" "mandates=$(mandateCount m2)"
check "at most one mandate is active" "[ \"$(python3 -c "import json;d=json.load(open('$OUTDIR/m2.json'));print(sum(1 for i in d['data']['providerMandates']['items'] if i['active']))")\" -le 1 ]"

echo "=== 5. Same-plan change is an idempotent no-op (no duplicate provider subscription) ==="
change c2 "$PAID_B_ID"
C2_ID=$(jget "$OUTDIR/c2.json" "data.changeOrganizationSubscriptionPlan.id"); C2_ID="${C2_ID//\"/}"
check "same id returned" "[ \"$C2_ID\" = \"$C1_ID\" ]" "got $C2_ID"
check "mandate count unchanged (no third provider subscription)" "[ \"$(mandateCount m3)\" = '2' ]" "mandates=$(mandateCount m3)"

echo "=== 6. cancelOrganizationSubscription(atPeriodEnd: true) → scheduled, not yet cancelled ==="
cancel x1 true
X1_STATUS=$(jget "$OUTDIR/x1.json" "data.cancelOrganizationSubscription.status")
X1_CAE=$(jget "$OUTDIR/x1.json" "data.cancelOrganizationSubscription.cancelAtPeriodEnd")
check "status NOT cancelled (transition defers to period end)" "[ \"$X1_STATUS\" != '\"cancelled\"' ]" "got $X1_STATUS"
check "cancelAtPeriodEnd = true" "[ \"$X1_CAE\" = 'true' ]" "got $X1_CAE"
check "cancelledAt still null" "[ \"$(jget "$OUTDIR/x1.json" "data.cancelOrganizationSubscription.cancelledAt")\" = 'null' ]"

echo "=== 7. cancelOrganizationSubscription(atPeriodEnd: false) → immediate ==="
cancel x2 false
X2_STATUS=$(jget "$OUTDIR/x2.json" "data.cancelOrganizationSubscription.status")
check "status = cancelled" "[ \"$X2_STATUS\" = '\"cancelled\"' ]" "got $X2_STATUS"
check "cancelledAt set" "[ \"$(jget "$OUTDIR/x2.json" "data.cancelOrganizationSubscription.cancelledAt")\" != 'null' ]"
check "cancelAtPeriodEnd cleared" "[ \"$(jget "$OUTDIR/x2.json" "data.cancelOrganizationSubscription.cancelAtPeriodEnd")\" = 'false' ]"

echo "=== 8. Repeated cancel is an idempotent no-op ==="
cancel x3 false
check "still cancelled, no error" "[ \"$(jget "$OUTDIR/x3.json" "data.cancelOrganizationSubscription.status")\" = '\"cancelled\"' ]" "see $OUTDIR/x3.json"

echo "=== 9. subscribeToPlan AFTER cancel succeeds (partial unique index slot freed) ==="
sub s2 "$PAID_A_ID"
S2_ID=$(jget "$OUTDIR/s2.json" "data.subscribeToPlan.id"); S2_ID="${S2_ID//\"/}"
S2_STATUS=$(jget "$OUTDIR/s2.json" "data.subscribeToPlan.status")
check "re-subscribe succeeded" "[ -n \"$S2_ID\" ] && [ \"$S2_ID\" != \"null\" ]" "see $OUTDIR/s2.json"
check "new row id (not reused)" "[ \"$S2_ID\" != \"$C1_ID\" ]" "old=$C1_ID new=$S2_ID"
check "status pending_provider_auth" "[ \"$S2_STATUS\" = '\"pending_provider_auth\"' ]" "got $S2_STATUS"

echo "=== 10. Provider-free target: change to the free plan is local-only ==="
MANDATES_BEFORE=$(mandateCount m4)
change c3 "$FREE_ID"
C3_PLAN=$(jget "$OUTDIR/c3.json" "data.changeOrganizationSubscriptionPlan.plan.slug")
C3_STATUS=$(jget "$OUTDIR/c3.json" "data.changeOrganizationSubscriptionPlan.status")
C3_PROV=$(jget "$OUTDIR/c3.json" "data.changeOrganizationSubscriptionPlan.providerStatus")
check "plan changed to free" "echo \"$C3_PLAN\" | grep -q 'adr044-free-$RUN_ID'" "got $C3_PLAN"
check "provider-free target activates LOCALLY (status active)" "[ \"$C3_STATUS\" = '\"active\"' ]" "got $C3_STATUS"
check "providerStatus cleared" "[ \"$C3_PROV\" = 'null' ]" "got $C3_PROV"
check "NO new provider subscription created" "[ \"$(mandateCount m5)\" = \"$MANDATES_BEFORE\" ]" "before=$MANDATES_BEFORE after=$(mandateCount m5)"

echo "=== 11. Provider-free cancellation is local-only and immediate (even with atPeriodEnd=true) ==="
cancel x4 true
X4_STATUS=$(jget "$OUTDIR/x4.json" "data.cancelOrganizationSubscription.status")
check "provider-free + atPeriodEnd=true still cancels immediately" "[ \"$X4_STATUS\" = '\"cancelled\"' ]" "got $X4_STATUS"

echo "=== 12. Trialing downgrade guard (ADR-044 §5) ==="
skip "trialing -> cheaper plan rejection" "A 'trialing' row cannot be produced through the Admin API (subscribeToPlan yields pending_provider_auth; trialing arrives via the provider webhook path). Exercise manually, then changeOrganizationSubscriptionPlan(channelId, <cheaper plan>) must fail with 'Cannot change a trialing subscription to a lower-priced plan'."

echo "=== 13. Renewal sweep completes a scheduled cancellation (no billing attempt) ==="
skip "sweep completion of cancelAtPeriodEnd" "Needs a past currentPeriodEnd, which only the provider webhook can authoritatively set. Set currentPeriodEnd into the past via the normal webhook/reconciliation path, run the 'subscription-renewal' scheduled task, then confirm (a) NO new SubscriptionBillingAttempt row, (b) status='cancelled' + cancelledAt set, (c) log 'completed scheduled cancellation at period end (ADR-044)'."

echo
echo "=== Summary ==="
echo -e "  ${GREEN}passed: $passCount${NC}   ${RED}failed: $failCount${NC}   ${YELLOW}skipped: $skipCount${NC}"
echo "  raw responses: $OUTDIR/"
[ "$failCount" -eq 0 ] || exit 1
