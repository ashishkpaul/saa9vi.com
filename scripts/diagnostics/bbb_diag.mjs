// BBB error.forbidden diagnostic — READ-ONLY.
// DIAGNOSTIC-ONLY tool: it reads PostgreSQL directly for fixture introspection.
// This is NOT an application data-access pattern — application code must use
// Vendure services + RequestContext. No DB mutations are performed here.
// Replicates BbbApiService protocol byte-for-byte:
//   checksum = sha256(methodName + URLSearchParams(params) + apiSecret)
//   secret   = AES-256-GCM decrypt of encryptedApiSecret (BbbEncryptionService)
import { readFileSync } from 'fs';
import pg from 'pg';
import crypto from 'crypto';

const env = Object.fromEntries(
  readFileSync('/home/ashish/edu/saa9vi_com/.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const client = new pg.Client({
  host: env.DB_HOST, port: +env.DB_PORT, database: env.DB_NAME,
  user: env.DB_USERNAME, password: env.DB_PASSWORD,
});
await client.connect();

const { rows: servers } = await client.query(
  'SELECT id, name, "apiUrl", "encryptedApiSecret" FROM bbb_server ORDER BY id',
);
const { rows: meetings } = await client.query(
  `SELECT id, "bbbMeetingId", "bbbInternalMeetingId", state, "serverId"
   FROM bbb_meeting WHERE "bbbMeetingId" IS NOT NULL ORDER BY id DESC LIMIT 3`,
);
await client.end();

function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
  const key = Buffer.from(env.BBB_ENCRYPTION_KEY, 'hex');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return d.update(enc).toString('utf8') + d.final('utf8');
}

function checksum(method, params, secret) {
  const qs = new URLSearchParams(params).toString();
  return {
    qs,
    checksum: crypto.createHash('sha256')
      .update(method + qs + secret).digest('hex'),
  };
}

function signedUrl(apiUrl, method, params, secret) {
  const { qs, checksum: ck } = checksum(method, params, secret);
  return { url: `${apiUrl.replace(/\/$/, '')}/api/${method}?${qs}&checksum=${ck}`, method, qs, ck };
}

const log = (...a) => console.log(...a);

// ─── Test A: manual BBB control meeting ─────────────────────────────────────
const s1 = servers.find((s) => s.enabled) ?? servers[0];
const secret = decrypt(s1.encryptedApiSecret);
log(`server ${s1.id} ${s1.name} apiUrl=${s1.apiUrl} secretLen=${secret.length}`);

const manualId = `diag-manual-${Date.now()}`;
const create = signedUrl(s1.apiUrl, 'create', {
  meetingID: manualId, name: 'Diag Manual Meeting',
  attendeePW: 'diagattendeepw', moderatorPW: 'diagmodpw',
}, secret);
log(`\n[Test A] CREATE manual meeting ${manualId}`);
log(`  method=create qs=${create.qs} checksum=${create.ck}`);
const cRes = await (await fetch(create.url)).text();
log(`  response: ${cRes.replace(/\s+/g, ' ').slice(0, 220)}`);

async function getMeetingInfo(meetingId, label) {
  const g = signedUrl(s1.apiUrl, 'getMeetingInfo', { meetingID: meetingId }, secret);
  try {
    const res = await (await fetch(g.url)).text();
    const ok = res.includes('SUCCESS');
    log(`  [${label}] getMeetingInfo(${meetingId}): ${ok ? 'SUCCESS' : res.replace(/\s+/g, ' ').slice(0, 160)}`);
    return { ok, res };
  } catch (e) {
    log(`  [${label}] getMeetingInfo(${meetingId}): FETCH ERROR ${e.message}`);
    return { ok: false };
  }
}

log(`\n[Test C] getMeetingInfo timing on MANUAL meeting ${manualId}`);
for (const delay of [0, 1000, 3000, 10000]) {
  if (delay) await new Promise((r) => setTimeout(r, delay));
  await getMeetingInfo(manualId, `t+${delay}ms`);
}

// Join URL construction + fetch (BBB materializes the session on first join)
const join = signedUrl(s1.apiUrl, 'join', {
  fullName: 'Diag Moderator', meetingID: manualId, password: 'diagmodpw',
}, secret);
log(`\n[Test A] JOIN moderator on manual meeting (materializes room)`);
const jRes = await (await fetch(join.url, { redirect: 'manual' })).text();
log(`  join response: ${jRes.replace(/\s+/g, ' ').slice(0, 160)}`);
log(`\n[Test C] getMeetingInfo AFTER join on manual meeting`);
await getMeetingInfo(manualId, 'post-join');

// ─── Test B: Saa9vi-created meetings ────────────────────────────────────────
log(`\n[Test B] getMeetingInfo on Saa9vi-created meetings`);
for (const m of meetings) {
  log(`  meeting ${m.id} bbbMeetingId=${m.bbbMeetingId} internal=${m.bbbInternalMeetingId} state=${m.state} serverId=${m.serverId}`);
  await getMeetingInfo(m.bbbMeetingId, `saavi-${m.id}`);
}

log('\nDONE — read-only diagnostic.');