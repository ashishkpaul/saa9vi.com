/**
 * Commit 3.5c — in-process checksum probe against the live BBB host.
 *
 * Decrypts the oci-bbb-server API secret IN-PROCESS via the app's own
 * BbbEncryptionService (BBB_ENCRYPTION_KEY from .env, same as runtime) and
 * issues READ-ONLY getMeetings + hooks/list, each signed sha256 then sha1
 * through the SAME checksum path BbbApiService/BbbHooksService use
 * (method + querystring + secret).
 *
 * HARD CONSTRAINTS:
 *   - NEVER print/log/write the secret, signed URL, or checksum. Errors and
 *     stack traces are redacted before printing.
 *   - Read-only calls only: getMeetings, hooks/list.
 *   - Output only: algorithm, HTTP status, returncode, messageKey.
 *   - On CREDENTIAL_UNREADABLE / any decrypt failure: stop, report, exit 3.
 *     NEVER ask for the secret to be pasted.
 *   - No secret on the command line or in shell history (env/file only).
 *
 * Usage:
 *   ts-node scripts/bbb/checksum-probe.ts
 */
import 'dotenv/config';
import 'reflect-metadata';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { BbbEncryptionService } from '../../src/plugins/bigbluebutton-plugin/services/bbb-encryption.service';

const API_BASE = 'https://meeting.saa9vi.com/bigbluebutton';

function redact(input: string): string {
  return input.replace(/[0-9a-f]{32,128}/gi, '[REDACTED]').replace(/checksum=[^&\s]*/g, 'checksum=[REDACTED]');
}

async function probeCall(
  base: string,
  method: 'getMeetings' | 'hooks/list',
  secret: string,
  alg: 'sha1' | 'sha256',
): Promise<void> {
  const path = method === 'getMeetings' ? '/api/getMeetings' : '/api/hooks/list';
  const checksum = crypto.createHash(alg).update(method + '' + secret).digest('hex');
  const url = `${base}${path}?checksum=${checksum}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    const rc = text.match(/<returncode>(\w+)<\/returncode>/)?.[1] ?? 'n/a';
    const key = text.match(/<messageKey>([^<]*)<\/messageKey>/)?.[1] ?? '-';
    console.log(`method=${method} alg=${alg} http=${res.status} returncode=${rc} messageKey=${key}`);
  } catch (err: any) {
    console.log(`method=${method} alg=${alg} ERROR ${redact(String(err?.message ?? err)).slice(0, 120)}`);
  }
}

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'vendure',
    schema: process.env.DB_SCHEMA ?? 'public',
  });
  await ds.initialize();
  try {
    const rows: Array<{ id: string; apiUrl: string; encryptedApiSecret: string }> = await ds.query(
      `SELECT id, "apiUrl", "encryptedApiSecret" FROM bbb_server WHERE name = 'oci-bbb-server' LIMIT 1`,
    );
    if (rows.length === 0) {
      console.error('No oci-bbb-server row found — aborting.');
      process.exit(3);
    }
    const row = rows[0];
    const enc = new BbbEncryptionService();
    enc.onModuleInit();
    let secret: string;
    try {
      secret = enc.decrypt(row.encryptedApiSecret);
    } catch (err: any) {
      console.error(`DECRYPT FAILED (${redact(String(err?.message ?? err)).slice(0, 160)}). NOT asking for the secret — fix BBB_ENCRYPTION_KEY sync first.`);
      process.exit(3);
    }
    if (!secret) {
      console.error('Decrypted secret is empty — aborting.');
      process.exit(3);
    }
    const base = row.apiUrl.replace(/\/+$/, '').replace(/\/api$/, '');
    for (const method of ['getMeetings', 'hooks/list'] as const) {
      for (const alg of ['sha256', 'sha1'] as const) {
        await probeCall(base || API_BASE, method, secret, alg);
      }
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(`probe failed: ${redact(err?.stack ?? String(err)).slice(0, 300)}`);
  process.exit(1);
});
