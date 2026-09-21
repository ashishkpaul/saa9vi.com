#!/usr/bin/env python3
"""
Seed demo sessions and entitlements for S1/UX testing.

Uses only the GraphQL API — no direct DB mutations.
Target: channel 15 (Apex Academy Live Classroom, org 3, trainer member 2)

Run from repo root:
  python3 scripts/seed/seed-demo-sessions.py
"""

import urllib.request
import urllib.error
import json
import sys

ADMIN_API = "http://localhost:3000/admin-api"
SHOP_API  = "http://localhost:3000/shop-api"
CHANNEL_TOKEN = "tok_apex-academy_5famcu"
ORG_ID    = "3"
TRAINER_ID = "2"

# ── helpers ──────────────────────────────────────────────────────────────────

admin_cookie = None
shop_cookie  = None

def gql(url, query, variables=None, token=None, cookie=None):
    global admin_cookie, shop_cookie
    body = {"query": query}
    if variables:
        body["variables"] = variables
    data = json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["vendure-token"] = token
    req = urllib.request.Request(url, data=data, headers=headers)
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            sc = resp.headers.get("Set-Cookie")
            if sc:
                cookie_val = sc.split(";")[0]
                if url == ADMIN_API:
                    admin_cookie = cookie_val
                else:
                    shop_cookie = cookie_val
            return result
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:200]}")
        raise

def admin(query, variables=None):
    return gql(ADMIN_API, query, variables, cookie=admin_cookie)

def shop(query, variables=None, token=CHANNEL_TOKEN, use_session=False):
    return gql(SHOP_API, query, variables, token=token, cookie=(shop_cookie if use_session else None))

def ok(result, path):
    """Navigate a dot-path and return value, or print error."""
    d = result
    for k in path.split("."):
        if "errors" in d:
            print(f"  GraphQL errors: {d['errors']}")
            return None
        d = d.get("data", d).get(k, d) if isinstance(d, dict) else d
    return d

# ── 1. Login as superadmin ────────────────────────────────────────────────────

print("1. Logging in as superadmin...")
r = gql(ADMIN_API, "mutation { login(username:\"superadmin\",password:\"superadmin\") { __typename } }")
if "errors" in r:
    print("Login failed:", r["errors"])
    sys.exit(1)
print("   ✅ logged in, cookie captured")

# ── 2. Check existing sessions ────────────────────────────────────────────────

print("\n2. Existing sessions for org 3...")
r = admin('{ bbbScheduledSessions(organizationId: "3") { id title status } }')
existing = r["data"]["bbbScheduledSessions"]
existing_titles = {s["title"] for s in existing}
for s in existing:
    print(f"   id={s['id']} [{s['status']}] {s['title'][:50]}")

# ── 3. Create sessions ────────────────────────────────────────────────────────

CREATE_SESSION = """
mutation CreateSession($input: CreateBbbScheduledSessionInput!) {
  createBbbScheduledSession(input: $input) { id title status }
}
"""

PUBLISH_SESSION = """
mutation Publish($id: ID!) {
  publishBbbScheduledSession(id: $id) { id title status }
}
"""

sessions_to_create = [
    # (title, startTime, endTime, subjectTags, publish?)
    (
        "Introduction to Python — Free Trial",
        "2026-10-10T14:00:00.000Z", "2026-10-10T15:00:00.000Z",
        ["python", "beginners", "free-trial"], True,
    ),
    (
        "Machine Learning Fundamentals",
        "2026-10-15T09:00:00.000Z", "2026-10-15T11:00:00.000Z",
        ["machine-learning", "python", "data-science"], True,
    ),
    (
        "Node.js Backend Architecture",
        "2026-10-20T16:00:00.000Z", "2026-10-20T17:30:00.000Z",
        ["nodejs", "backend", "javascript"], True,
    ),
    (
        "System Design for Engineers",
        "2026-10-25T11:00:00.000Z", "2026-10-25T13:00:00.000Z",
        ["system-design", "architecture"], True,
    ),
    (
        "TypeScript Advanced Patterns",
        "2026-11-01T10:00:00.000Z", "2026-11-01T12:00:00.000Z",
        ["typescript", "javascript", "patterns"], False,  # stays DRAFT
    ),
]

print("\n3. Creating sessions...")
created_session_ids = []
for title, start, end, tags, publish in sessions_to_create:
    if title in existing_titles:
        print(f"   ⏭  already exists: {title[:50]}")
        # find its id
        for s in existing:
            if s["title"] == title:
                created_session_ids.append((s["id"], s["status"], publish))
        continue

    r = admin(CREATE_SESSION, {
        "input": {
            "organizationId": ORG_ID,
            "trainerId": TRAINER_ID,
            "title": title,
            "startTime": start,
            "endTime": end,
            "subjectTags": tags,
        }
    })
    if "errors" in r:
        print(f"   ❌ failed to create '{title}': {r['errors']}")
        continue
    sess = r["data"]["createBbbScheduledSession"]
    print(f"   ✅ created id={sess['id']} [{sess['status']}]: {title[:50]}")
    created_session_ids.append((sess["id"], sess["status"], publish))

# ── 4. Publish sessions ───────────────────────────────────────────────────────

print("\n4. Publishing sessions...")
for sid, status, should_publish in created_session_ids:
    if not should_publish:
        print(f"   ⏭  id={sid} keeping DRAFT")
        continue
    if status == "SCHEDULED":
        print(f"   ⏭  id={sid} already SCHEDULED")
        continue
    r = admin(PUBLISH_SESSION, {"id": sid})
    if "errors" in r:
        print(f"   ❌ failed to publish id={sid}: {r['errors']}")
        continue
    sess = r["data"]["publishBbbScheduledSession"]
    print(f"   ✅ published id={sess['id']} [{sess['status']}]: {sess['title'][:45]}")

# ── 5. Register/verify a demo learner and create an entitlement ───────────────

print("\n5. Setting up demo learner on channel 15...")

DEMO_EMAIL = "demo-learner@apex.test"
DEMO_PASS  = "Demo1234!"

# Register
r = shop("""
mutation RegisterCustomerAccount($input: RegisterCustomerInput!) {
  registerCustomerAccount(input: $input) {
    __typename ... on Success { success } ... on ErrorResult { errorCode message }
  }
}
""", {"input": {"emailAddress": DEMO_EMAIL, "firstName": "Demo", "lastName": "Learner", "password": DEMO_PASS}})
result = r["data"]["registerCustomerAccount"]
if result["__typename"] == "Success":
    print(f"   ✅ registered {DEMO_EMAIL}")
    # find verification token from email files
    import os, glob
    email_files = sorted(glob.glob("/home/ashish/edu/saa9vi_com/static/email/test-emails/*.json"))
    token = None
    for f in reversed(email_files):
        if "demo-learner" in f or "apex.test" in f.replace("@",""):
            with open(f) as ef:
                content = ef.read()
            import re
            m = re.search(r'verify\?token=([A-Za-z0-9_\-]+)', content)
            if m:
                token = m.group(1)
                break
    if token:
        r2 = shop("""
mutation VerifyCustomerAccount($token: String!) {
  verifyCustomerAccount(token: $token) {
    __typename ... on CurrentUser { id identifier } ... on ErrorResult { errorCode message }
  }
}
""", {"token": token}, use_session=True)
        vc = r2["data"]["verifyCustomerAccount"]
        if vc["__typename"] == "CurrentUser":
            print(f"   ✅ verified — customer id={vc['id']}")
        else:
            print(f"   ⚠️  verify result: {vc}")
    else:
        print("   ⚠️  could not find verification token — check mailbox manually")
elif "CONFLICT" in result.get("errorCode","") or "EXISTS" in result.get("errorCode",""):
    print(f"   ⏭  {DEMO_EMAIL} already exists")
else:
    print(f"   ⚠️  register result: {result}")

# Login as demo learner to get customer ID
r = shop("""
mutation Login($u: String!, $p: String!) {
  login(username: $u, password: $p) {
    __typename ... on CurrentUser { id identifier } ... on ErrorResult { errorCode message }
  }
}
""", {"u": DEMO_EMAIL, "p": DEMO_PASS}, use_session=True)
login_result = r["data"]["login"]
if login_result["__typename"] == "CurrentUser":
    customer_id = login_result["id"]
    print(f"   ✅ logged in as demo learner — customer id={customer_id}")

    # Create a bbb_session entitlement for the first published SCHEDULED session
    # so the learning dashboard shows something
    first_scheduled = next(
        ((sid, status) for sid, status, pub in created_session_ids if status == "SCHEDULED" or pub),
        None
    )
    if first_scheduled:
        sid = first_scheduled[0]
        r3 = admin("""
mutation CreateEntitlement($input: CreateBbbEntitlementInput!) {
  createBbbEntitlement(input: $input) { id type resourceId }
}
""", {"input": {
    "customerId": str(customer_id),
    "type": "bbb_session",
    "resourceId": str(sid),
    "source": "admin",
}})
        if "errors" not in r3:
            ent = r3["data"]["createBbbEntitlement"]
            print(f"   ✅ entitlement created — id={ent['id']} type={ent['type']} resourceId={ent['resourceId']}")
        else:
            print(f"   ⚠️  entitlement error: {r3['errors']}")
else:
    print(f"   ⚠️  login result: {login_result}")

# ── 6. Summary ────────────────────────────────────────────────────────────────

print("\n6. Final session list for org 3:")
r = admin('{ bbbScheduledSessions(organizationId: "3") { id title status visibility isTrial } }')
for s in r["data"]["bbbScheduledSessions"]:
    print(f"   id={s['id']} [{s['status']}] {s['title'][:50]}")

print("\nDone. Demo data seeded via GraphQL API only.")
print(f"Storefront: http://localhost:3001/en  (channel 15 — Apex Academy)")
print(f"Demo learner: {DEMO_EMAIL} / {DEMO_PASS}")
print(f"Admin dashboard: http://localhost:3000/dashboard")
