#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
ROOT_DIR="$DIR/../.."

echo "======================================================"
echo "Saa9vi 3-Layer Testing & Verification Framework"
echo "======================================================"

# Step 1: Run Invariant Verification
echo ""
echo "--> Layer 1: Invariant Verification"
npx ts-node "$ROOT_DIR/src/platform/invariants/cli.ts"

# Step 2: Seed Demo Data via GraphQL API
echo ""
echo "--> Layer 1: Seeding Demo Academy Data via GraphQL Mutations"
chmod +x "$ROOT_DIR/scripts/seed/seed-via-graphql.sh"
"$ROOT_DIR/scripts/seed/seed-via-graphql.sh"

# Step 3: API Contract & Permission Smoke Verification
echo ""
echo "--> Layer 2: API Contract & Authorization Smoke Tests"
chmod +x "$ROOT_DIR/scripts/smoke/admin-api.sh"
chmod +x "$ROOT_DIR/scripts/smoke/shop-api.sh"
chmod +x "$ROOT_DIR/scripts/smoke/permissions.sh"

"$ROOT_DIR/scripts/smoke/admin-api.sh"
"$ROOT_DIR/scripts/smoke/shop-api.sh"
"$ROOT_DIR/scripts/smoke/permissions.sh"

# Step 4: Layer 3 Web & Endpoint Health Verification
echo ""
echo "--> Layer 3: Web & Endpoint Health Verification"
npx ts-node "$ROOT_DIR/scripts/smoke/ui-verification.ts"

echo ""
echo "======================================================"   
echo " Verification Successful: All 3 Layers Passed!"
echo "======================================================"
