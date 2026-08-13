#!/usr/bin/env bash
set -e

HOST="${HOST:-http://localhost:3000}"
COOKIE_MOD="/tmp/apex_mod_cookie.txt"
DATA_FIXTURE="/tmp/demo-data.json"

echo "=== Seeding Demo Academy via GraphQL Mutations (curl) ==="
echo "Target host: $HOST"

# 0. Health check
HEALTH_RESP=$(curl -s -X POST "$HOST/shop-api" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ activeChannel { id code } }"}' || echo "FAILED")

if [[ "$HEALTH_RESP" == "FAILED" ]] || [[ "$HEALTH_RESP" != *"data"* ]]; then
  echo "❌ Error: Server is not responding at $HOST. Please start the server (e.g. npm run dev) before running GraphQL seed."
  exit 1
fi

echo "  ✓ Server is healthy and listening at $HOST"

MOD_EMAIL="${DEMO_MODERATOR_EMAIL:-apex.moderator@example.com}"
MOD_PASS="${DEMO_MODERATOR_PASSWORD:-DemoModerator123!}"
INST_EMAIL="${DEMO_INSTRUCTOR_EMAIL:-apex.instructor@example.com}"
INST_PASS="${DEMO_INSTRUCTOR_PASSWORD:-DemoInstructor123!}"
CUST_EMAIL="${DEMO_CUSTOMER_EMAIL:-apex.customer@example.com}"
CUST_PASS="${DEMO_CUSTOMER_PASSWORD:-DemoCustomer123!}"

# Helper function to validate GraphQL response
validate_graphql() {
  local response="$1"
  local label="$2"
  node -e '
    try {
      const res = JSON.parse(process.argv[1]);
      if (res.errors && res.errors.length > 0) {
        const msg = res.errors[0].message;
        if (msg.includes("already exist") || msg.includes("already taken") || msg.includes("could not be created")) {
          console.log("  ℹ [" + process.argv[2] + "]: Entity/User already exists, continuing idempotently.");
          process.exit(0);
        }
        console.error("  ❌ [GraphQL Error - " + process.argv[2] + "]:", JSON.stringify(res.errors, null, 2));
        process.exit(1);
      }
      if (!res.data) {
        console.error("  ❌ [GraphQL Error - " + process.argv[2] + "]: Missing data payload!");
        process.exit(1);
      }
      console.log("  ✓ " + process.argv[2] + " mutation/query verified.");
    } catch (err) {
      console.error("  ❌ [Response Parse Error - " + process.argv[2] + "]:", err.message, process.argv[1]);
      process.exit(1);
    }
  ' "$response" "$label"
}

# 1. Register Tenant via GraphQL Shop API
echo "[1] Registering Tenant (Apex Academy) via Shop API..."
REG_RESP=$(curl -s -X POST "$HOST/shop-api" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"mutation RegisterTenant(\$input: RegisterTenantInput!) { registerNewTenant(input: \$input) { channelId channelToken administratorId } }\",
    \"variables\": {
      \"input\": {
        \"businessName\": \"Apex Academy\",
        \"firstName\": \"Apex\",
        \"lastName\": \"Admin\",
        \"emailAddress\": \"$MOD_EMAIL\",
        \"password\": \"$MOD_PASS\",
        \"contactEmail\": \"contact@apexacademy.io\"
      }
    }
  }"
)
validate_graphql "$REG_RESP" "Register Tenant"

CHANNEL_TOKEN=$(node -p "
  try {
    const res = JSON.parse(process.argv[1]);
    res.data?.registerNewTenant?.channelToken || ''
  } catch { '' }
" "$REG_RESP")

CHANNEL_ID=$(node -p "
  try {
    const res = JSON.parse(process.argv[1]);
    res.data?.registerNewTenant?.channelId || ''
  } catch { '' }
" "$REG_RESP")

if [ -z "$CHANNEL_TOKEN" ]; then
  # Fallback: Query channels as SuperAdmin if tenant was already registered
  echo "  ℹ Retrieving existing channel token via Admin API..."
  SUPER_COOKIE="/tmp/super_cookie.txt"
  curl -s -X POST "$HOST/admin-api" -H "Content-Type: application/json" -c "$SUPER_COOKIE" \
    -d '{"query":"mutation { login(username:\"superadmin\", password:\"superadmin\") { ... on CurrentUser { id } } }"}' > /dev/null
  
  CHANNELS_JSON=$(curl -s -X POST "$HOST/admin-api" -H "Content-Type: application/json" -b "$SUPER_COOKIE" \
    -d '{"query":"{ channels { items { id code token } } }"}')
  
  CHANNEL_TOKEN=$(node -p "
    try {
      const items = JSON.parse(process.argv[1]).data.channels.items;
      const ch = items.find(c => c.code.startsWith('apex-academy'));
      ch ? ch.token : ''
    } catch { '' }
  " "$CHANNELS_JSON")
  
  CHANNEL_ID=$(node -p "
    try {
      const items = JSON.parse(process.argv[1]).data.channels.items;
      const ch = items.find(c => c.code.startsWith('apex-academy'));
      ch ? ch.id : ''
    } catch { '' }
  " "$CHANNELS_JSON")
fi

echo "  ✓ Tenant Channel ID: $CHANNEL_ID, Token: $CHANNEL_TOKEN"

# 2. Login Moderator via Admin API
echo "[2] Logging in Tenant Moderator..."
MOD_LOGIN_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -c "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation LogIn(\$username: String!, \$password: String!) { login(username: \$username, password: \$password) { ... on CurrentUser { id identifier } } }\",
    \"variables\": {
      \"username\": \"$MOD_EMAIL\",
      \"password\": \"$MOD_PASS\"
    }
  }"
)
validate_graphql "$MOD_LOGIN_RESP" "Moderator Login"

# 3. Register Instructor Customer Account
echo "[3] Registering Instructor Customer via Shop API..."
INST_REG_RESP=$(curl -s -X POST "$HOST/shop-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -d "{
    \"query\": \"mutation RegisterCustomer(\$input: RegisterCustomerInput!) { registerCustomerAccount(input: \$input) { ... on Success { success } } }\",
    \"variables\": {
      \"input\": {
        \"emailAddress\": \"$INST_EMAIL\",
        \"firstName\": \"John\",
        \"lastName\": \"Doe\",
        \"password\": \"$INST_PASS\"
      }
    }
  }"
)
validate_graphql "$INST_REG_RESP" "Instructor Customer Registration"

# Query Instructor Customer ID
INST_CUST_JSON=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"{ customers(options:{filter:{emailAddress:{eq:\\\"$INST_EMAIL\\\"}}}) { items { id emailAddress } } }\"
  }"
)
INST_CUST_ID=$(node -p "
  try {
    JSON.parse(process.argv[1]).data.customers.items[0].id
  } catch { '1' }
" "$INST_CUST_JSON")

# 4. Create Instructor Profile
echo "[4] Creating Instructor Profile via Admin API..."
INST_PROFILE_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation CreateInstructorProfile(\$input: CreateInstructorProfileInput!) { createInstructorProfile(input: \$input) { id slug fullName } }\",
    \"variables\": {
      \"input\": {
        \"customerId\": \"$INST_CUST_ID\",
        \"slug\": \"john-doe\",
        \"fullName\": \"John Doe\",
        \"bio\": \"Senior Software Architect and Bootcamp Lead.\",
        \"credentials\": \"Lead Python Instructor\",
        \"isPublic\": true,
        \"isActive\": true
      }
    }
  }"
)
validate_graphql "$INST_PROFILE_RESP" "Create Instructor Profile"

# 5. Create BBB Organization
echo "[5] Creating BigBlueButton Organization via Admin API..."
BBB_ORG_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation CreateBbbOrg(\$input: CreateBbbOrganizationInput!) { createBbbOrganization(input: \$input) { id slug name } }\",
    \"variables\": {
      \"input\": {
        \"channelId\": \"$CHANNEL_ID\",
        \"slug\": \"apex-academy-org\",
        \"name\": \"Apex Academy Organization\"
      }
    }
  }"
)
validate_graphql "$BBB_ORG_RESP" "Create BBB Organization"

# 6. Register Student Customer
echo "[6] Registering Student Customer via Shop API..."
STUDENT_REG_RESP=$(curl -s -X POST "$HOST/shop-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -d "{
    \"query\": \"mutation RegisterCustomer(\$input: RegisterCustomerInput!) { registerCustomerAccount(input: \$input) { ... on Success { success } } }\",
    \"variables\": {
      \"input\": {
        \"emailAddress\": \"$CUST_EMAIL\",
        \"firstName\": \"Apex\",
        \"lastName\": \"Learner\",
        \"password\": \"$CUST_PASS\"
      }
    }
  }"
)
validate_graphql "$STUDENT_REG_RESP" "Student Registration"

# 7. Write Fixture JSON
node -e '
  const fs = require("fs");
  const data = {
    channelCode: "apex-academy",
    channelToken: process.argv[1],
    channelId: process.argv[2],
    moderatorEmail: process.argv[3],
    moderatorPassword: process.argv[4],
    instructorEmail: process.argv[5],
    instructorPassword: process.argv[6],
    customerEmail: process.argv[7],
    customerPassword: process.argv[8]
  };
  fs.writeFileSync(process.argv[9], JSON.stringify(data, null, 2));
  console.log("  ✓ Wrote demo data fixture to " + process.argv[9]);
' "$CHANNEL_TOKEN" "$CHANNEL_ID" "$MOD_EMAIL" "$MOD_PASS" "$INST_EMAIL" "$INST_PASS" "$CUST_EMAIL" "$CUST_PASS" "$DATA_FIXTURE"

echo "=== GraphQL Seeding Completed Successfully ==="
