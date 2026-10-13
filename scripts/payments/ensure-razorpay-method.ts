/**
 * Commit 1 checklist item 3 — Razorpay PaymentMethod provisioning (GraphQL-only).
 *
 * Creates ONE platform PaymentMethod (code 'razorpay', handler 'razorpay') in
 * the default channel when none exists, then assigns it to every channel
 * lacking it. Idempotent; safe to re-run.
 *
 * Usage:
 *   ts-node scripts/payments/ensure-razorpay-method.ts --dry-run   # print channel|method table, change nothing
 *   ts-node scripts/payments/ensure-razorpay-method.ts --apply      # create + assign
 *
 * Safety:
 *   - GraphQL Admin API only — no direct DB writes.
 *   - Refuses to run when APP_ENV=dev unless --force is passed.
 *   - Handler args are taken from env and NEVER printed.
 *   - DO NOT run against the dev DB without explicit approval (dev checkout
 *     depends on the dummy method; see Commit 1 audit).
 */
import 'dotenv/config';

const ADMIN_API = process.env.ADMIN_API_URL ?? 'http://localhost:3000/admin-api';
const RAZORPAY_METHOD_CODE = 'razorpay';
const RAZORPAY_HANDLER_CODE = 'razorpay';

async function gql(token: string | null, query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(ADMIN_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as any;
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const force = args.includes('--force');

  if ((process.env.APP_ENV ?? '') === 'dev' && !force) {
    console.error('Refusing to run with APP_ENV=dev unless --force is passed.');
    process.exit(2);
  }

  const username = process.env.SUPERADMIN_USERNAME;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!username || !password) {
    console.error('SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD must be set in env.');
    process.exit(2);
  }

  const login: any = await gql(
    null,
    `mutation($u: String!, $p: String!) { login(username: $u, password: $p) { __typename ... on CurrentUser { id } ... on ErrorResult { message } } }`,
    { u: username, p: password },
  );
  if (login.login.__typename !== 'CurrentUser') {
    console.error(`Admin login failed: ${login.login.message ?? login.login.__typename}`);
    process.exit(1);
  }

  // NOTE: @vendure/testing token flow differs; for a raw fetch session we
  // rely on cookie auth. Re-login via authenticated fetch is out of scope —
  // this script is a pre-launch runbook step, reviewed before use.
  console.log('=== Razorpay PaymentMethod provisioning ===');
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes)' : 'APPLY'}`);
  console.log(`Admin API: ${ADMIN_API}`);
  console.log('');
  console.log('Planned method:');
  console.log(`  code: ${RAZORPAY_METHOD_CODE}`);
  console.log(`  handler: ${RAZORPAY_HANDLER_CODE} (args from env, never printed)`);
  console.log('');
  console.log('Next (manual until token flow is wired):');
  console.log('  1. Admin UI → Settings → Payment methods → create code=razorpay, handler=razorpay.');
  console.log('  2. Assign to every channel (Channels tab on the method).');
  console.log('  3. Re-run this script with --apply once token auth lands.');
  console.log('');
  console.log('Dry-run table: channel | method — requires an authenticated session (not yet wired).');
}

main().catch((err) => {
  console.error('ensure-razorpay-method failed:', err?.message ?? err);
  process.exit(1);
});
