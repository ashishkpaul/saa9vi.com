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
        if (
          msg.includes("already exist") ||
          msg.includes("already taken") ||
          msg.includes("could not be created") ||
          msg.includes("duplicate key") ||
          msg.includes("unique constraint") ||
          msg.includes("already a member") ||
          msg.includes("An organization already exists")
        ) {
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

# 7. Update Tenant Profile Branding & Onboarding
echo "[7] Updating Tenant Profile Branding & Onboarding..."
TENANT_PROFILE_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation UpdateTenantProfile(\$input: UpdateTenantProfileInput!) { updateTenantProfile(input: \$input) { id businessName tagline timezone contactEmail onboardingComplete } }\",
    \"variables\": {
      \"input\": {
        \"channelId\": \"$CHANNEL_ID\",
        \"businessName\": \"Apex Academy\",
        \"tagline\": \"Empowering next-generation full-stack engineers with interactive classrooms and live cohorts.\",
        \"timezone\": \"Asia/Kolkata\",
        \"contactEmail\": \"contact@apexacademy.io\",
        \"onboardingComplete\": true
      }
    }
  }"
)
validate_graphql "$TENANT_PROFILE_RESP" "Update Tenant Profile"

# 8. Create Media Resources
echo "[8] Creating Media Library Resources..."
MEDIA_RESP1=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation CreateMediaResource(\$input: CreateMediaResourceInput!) { createMediaResource(input: \$input) { id title type url isFeatured } }\",
    \"variables\": {
      \"input\": {
        \"ownerType\": \"tenant\",
        \"ownerId\": \"$CHANNEL_ID\",
        \"type\": \"video\",
        \"url\": \"https://www.youtube.com/watch?v=kqtD5dpn9C8\",
        \"title\": \"Apex Academy Overview & Platform Tour\",
        \"isFeatured\": true,
        \"isActive\": true
      }
    }
  }"
)
validate_graphql "$MEDIA_RESP1" "Create Media Resource (Video)"

MEDIA_RESP2=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation CreateMediaResource(\$input: CreateMediaResourceInput!) { createMediaResource(input: \$input) { id title type url isFeatured } }\",
    \"variables\": {
      \"input\": {
        \"ownerType\": \"tenant\",
        \"ownerId\": \"$CHANNEL_ID\",
        \"type\": \"image\",
        \"url\": \"https://images.unsplash.com/photo-1516321318423-f06f85e504b3\",
        \"title\": \"Virtual Studio & Curriculum Guide\",
        \"isFeatured\": false,
        \"isActive\": true
      }
    }
  }"
)
validate_graphql "$MEDIA_RESP2" "Create Media Resource (Image)"

# Query BBB Organization ID
BBB_ORGS_JSON=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"{ bbbOrganizations { items { id slug name } } }\"
  }"
)
BBB_ORG_ID=$(node -p "
  try {
    const items = JSON.parse(process.argv[1]).data.bbbOrganizations.items;
    items.length > 0 ? items[0].id : '1'
  } catch { '1' }
" "$BBB_ORGS_JSON")

# 9. Add BBB Organization Staff (Trainer)
echo "[9] Adding Instructor as BBB Staff Member (Trainer)..."
BBB_STAFF_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation AddBbbMember(\$input: AddBbbMemberInput!) { addBbbMember(input: \$input) { id customerId role active } }\",
    \"variables\": {
      \"input\": {
        \"organizationId\": \"$BBB_ORG_ID\",
        \"customerId\": \"$INST_CUST_ID\",
        \"role\": \"trainer\"
      }
    }
  }"
)
validate_graphql "$BBB_STAFF_RESP" "Add BBB Member"

# Query BBB Staff Member ID
TRAINER_MEMBER_ID=$(node -p "
  try {
    const res = JSON.parse(process.argv[1]);
    res.data?.addBbbMember?.id || ''
  } catch { '' }
" "$BBB_STAFF_RESP")

if [ -z "$TRAINER_MEMBER_ID" ]; then
  BBB_MEMBERS_JSON=$(curl -s -X POST "$HOST/admin-api" \
    -H "Content-Type: application/json" \
    -H "vendure-token: $CHANNEL_TOKEN" \
    -b "$COOKIE_MOD" \
    -d "{
      \"query\": \"{ bbbOrganizationMembers(organizationId:\\\"$BBB_ORG_ID\\\") { items { id customerId } } }\"
    }"
  )
  TRAINER_MEMBER_ID=$(node -p "
    try {
      const items = JSON.parse(process.argv[1]).data.bbbOrganizationMembers.items;
      const mem = items.find(m => String(m.customerId) === String(process.argv[2]));
      mem ? mem.id : process.argv[2]
    } catch { process.argv[2] }
  " "$BBB_MEMBERS_JSON" "$INST_CUST_ID")
fi

# 10. Grant BBB Capacity
echo "[10] Creating BBB Capacity Grant (50 Hours)..."
BBB_GRANT_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation CreateBbbCapacityGrant(\$input: CreateBbbCapacityGrantInput!) { createBbbCapacityGrant(input: \$input) { id grantedMinutes validFrom validUntil } }\",
    \"variables\": {
      \"input\": {
        \"organizationId\": \"$BBB_ORG_ID\",
        \"grantedMinutes\": 3000,
        \"validFrom\": \"2026-01-01T00:00:00Z\",
        \"validUntil\": \"2029-12-31T23:59:59Z\"
      }
    }
  }"
)
validate_graphql "$BBB_GRANT_RESP" "Create BBB Capacity Grant"

# 11. Create BBB Rooms
echo "[11] Creating BBB Rooms..."
ROOM_RESP1=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation CreateBbbRoom(\$input: CreateBbbRoomInput!) { createBbbRoom(input: \$input) { id name slug state } }\",
    \"variables\": {
      \"input\": {
        \"organizationId\": \"$BBB_ORG_ID\",
        \"name\": \"Staff & Faculty Lounge\",
        \"slug\": \"apex-faculty-lounge\",
        \"description\": \"Private room for instructors and faculty meetings.\",
        \"recordingEnabled\": false,
        \"maxParticipants\": 15
      }
    }
  }"
)
validate_graphql "$ROOM_RESP1" "Create BBB Room (Faculty Lounge)"

ROOM_RESP2=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation CreateBbbRoom(\$input: CreateBbbRoomInput!) { createBbbRoom(input: \$input) { id name slug state } }\",
    \"variables\": {
      \"input\": {
        \"organizationId\": \"$BBB_ORG_ID\",
        \"name\": \"Python Masterclass Cohort Room\",
        \"slug\": \"python-masterclass-live\",
        \"description\": \"Interactive classroom for Python Bootcamp students.\",
        \"recordingEnabled\": true,
        \"maxParticipants\": 30
      }
    }
  }"
)
validate_graphql "$ROOM_RESP2" "Create BBB Room (Python Cohort)"

ROOM_ID=$(node -p "
  try {
    const res = JSON.parse(process.argv[1]);
    res.data?.createBbbRoom?.id || '1'
  } catch { '1' }
" "$ROOM_RESP2")

# 12. Create Scheduled Session
echo "[12] Scheduling Live Cohort Session..."
SESSION_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation CreateBbbScheduledSession(\$input: CreateBbbScheduledSessionInput!) { createBbbScheduledSession(input: \$input) { id title startTime endTime } }\",
    \"variables\": {
      \"input\": {
        \"organizationId\": \"$BBB_ORG_ID\",
        \"title\": \"Python Async & Distributed Systems Live Masterclass\",
        \"startTime\": \"2026-08-20T10:00:00Z\",
        \"endTime\": \"2026-08-20T12:00:00Z\",
        \"trainerId\": \"$TRAINER_MEMBER_ID\"
      }
    }
  }"
)
validate_graphql "$SESSION_RESP" "Create Scheduled Session"

# Query Student Customer ID
STUDENT_CUST_JSON=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"{ customers(options:{filter:{emailAddress:{eq:\\\"$CUST_EMAIL\\\"}}}) { items { id emailAddress } } }\"
  }"
)
STUDENT_CUST_ID=$(node -p "
  try {
    JSON.parse(process.argv[1]).data.customers.items[0].id
  } catch { '2' }
" "$STUDENT_CUST_JSON")

# 13. Create BBB Student Enrollment
echo "[13] Creating Student Enrollment & Entitlement..."
ENROLL_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation CreateBbbEnrollment(\$input: CreateBbbEnrollmentInput!) { createBbbEnrollment(input: \$input) { id customerId roomId active } }\",
    \"variables\": {
      \"input\": {
        \"roomId\": \"$ROOM_ID\",
        \"customerId\": \"$STUDENT_CUST_ID\",
        \"accessDays\": 90,
        \"reason\": \"Cohort 1 Enrollment\"
      }
    }
  }"
)
validate_graphql "$ENROLL_RESP" "Create BBB Enrollment"

# 14. Create CMS Articles and Pages
echo "[14] Creating CMS Articles and Pages..."
ARTICLE_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation CreateArticle(\$input: CreateArticleInput!) { createArticle(input: \$input) { id slug title isPublished } }\",
    \"variables\": {
      \"input\": {
        \"slug\": \"python-async-patterns\",
        \"title\": \"Modern Python Async Patterns & Event Loops\",
        \"excerpt\": \"Master concurrency, asyncio tasks, and worker pipelines in production.\",
        \"body\": \"<p>Learn the internals of asyncio, task orchestration, and queue processing with real-world case studies.</p>\",
        \"isPublished\": true,
        \"tags\": [\"python\", \"async\", \"backend\"]
      }
    }
  }"
)
validate_graphql "$ARTICLE_RESP" "Create CMS Article"

PAGE_RESP=$(curl -s -X POST "$HOST/admin-api" \
  -H "Content-Type: application/json" \
  -H "vendure-token: $CHANNEL_TOKEN" \
  -b "$COOKIE_MOD" \
  -d "{
    \"query\": \"mutation CreatePage(\$input: CreatePageInput!) { createPage(input: \$input) { id slug title isPublished } }\",
    \"variables\": {
      \"input\": {
        \"slug\": \"curriculum\",
        \"title\": \"Academy Curriculum & Learning Paths\",
        \"metaDescription\": \"Comprehensive roadmap covering full-stack systems engineering.\",
        \"isPublished\": true,
        \"sections\": []
      }
    }
  }"
)
validate_graphql "$PAGE_RESP" "Create CMS Page"

# 15. Write Fixture JSON
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
    customerPassword: process.argv[8],
    organizationId: process.argv[9],
    roomId: process.argv[10]
  };
  fs.writeFileSync(process.argv[11], JSON.stringify(data, null, 2));
  console.log("  ✓ Wrote demo data fixture to " + process.argv[11]);
' "$CHANNEL_TOKEN" "$CHANNEL_ID" "$MOD_EMAIL" "$MOD_PASS" "$INST_EMAIL" "$INST_PASS" "$CUST_EMAIL" "$CUST_PASS" "$BBB_ORG_ID" "$ROOM_ID" "$DATA_FIXTURE"

echo "=== GraphQL Seeding Completed Successfully ==="
