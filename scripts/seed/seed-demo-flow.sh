#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Demo Seed Flow — Orchestrates the 3-phase demo fixture lifecycle
#
# Phase 1: seed:demo-academy   — Creates full tenant, products, sessions,
#                                 customers, entitlements, reviews, orders,
#                                 payments (rich demo state)
# Phase 2: seed:demo-unblock   — Resets ONLY the demo-test preconditions
#                                 (stock=10, session=PUBLIC, reindexed)
#                                 WITHOUT fabricating business outcomes
# Phase 3: verify:demo-data    — Read-only verification of storefront state
#
# Usage:
#   npm run seed:demo-flow
#
# This is the entry point for preparing a fresh demo environment end-to-end.
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

GLOBAL_RED='\033[0;31m'
GLOBAL_GREEN='\033[0;32m'
GLOBAL_YELLOW='\033[1;33m'
GLOBAL_NC='\033[0m'

# ─── 1. Seed: Full demo academy data ────────────────────────────────────────
echo ""
echo -e "${GLOBAL_YELLOW}============================================${NC}"
echo -e "${GLOBAL_YELLOW}  Phase 1/3: seed:demo-academy${NC}"
echo -e "${GLOBAL_YELLOW}============================================${NC}"
echo ""

chmod +x "$ROOT_DIR/scripts/seed/seed-via-graphql.sh"
if "$ROOT_DIR/scripts/seed/seed-via-graphql.sh"; then
  echo -e "${GLOBAL_GREEN}✓ Phase 1 complete — demo academy seeded${NC}"
else
  echo -e "${GLOBAL_RED}✗ Phase 1 failed — aborting${NC}"
  exit 1
fi

# ─── 2. Unblock: Reset demo-test preconditions (data-only) ─────────────────
echo ""
echo -e "${GLOBAL_YELLOW}============================================${NC}"
echo -e "${GLOBAL_YELLOW}  Phase 2/3: seed:demo-unblock${NC}"
echo -e "${GLOBAL_YELLOW}============================================${NC}"
echo ""

chmod +x "$ROOT_DIR/scripts/seed/demo-unblock-graphql.sh"
if "$ROOT_DIR/scripts/seed/demo-unblock-graphql.sh"; then
  echo -e "${GLOBAL_GREEN}✓ Phase 2 complete — demo preconditions ready (no fabricated outcomes)${NC}"
else
  echo -e "${GLOBAL_RED}✗ Phase 2 failed — aborting${NC}"
  exit 1
fi

# ─── 3. Verify: Read-only state check ──────────────────────────────────────
echo ""
echo -e "${GLOBAL_YELLOW}============================================${NC}"
echo -e "${GLOBAL_YELLOW}  Phase 3/3: verify:demo-data${NC}"
echo -e "${GLOBAL_YELLOW}============================================${NC}"
echo ""

chmod +x "$ROOT_DIR/scripts/verify/demo-flow.sh"
if "$ROOT_DIR/scripts/verify/demo-flow.sh"; then
  echo -e "${GLOBAL_GREEN}✓ Phase 3 complete — demo state verified${NC}"
else
  echo -e "${GLOBAL_RED}✗ Phase 3 failed — demo state has issues${NC}"
  exit 1
fi

echo ""
echo -e "${GLOBAL_GREEN}============================================${NC}"
echo -e "${GLOBAL_GREEN}  Demo flow complete — all 3 phases passed${NC}"
echo -e "${GLOBAL_GREEN}============================================${NC}"
echo ""
echo "Environment is ready for demo testing."
echo "  - Admin:    http://localhost:3000/admin"
echo "  - Storefront: http://localhost:3000"
echo "  - Fixture data: /tmp/demo-data.json"
echo "  - Unblock state: /tmp/demo-unblock-state.json"
echo "  - Verification: /tmp/demo-verification.json"
