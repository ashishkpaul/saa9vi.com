/**
 * S6 — real-browser validation of the BBB dashboard (ADR-047 Phase 6 UX).
 *
 * WHY A BROWSER
 * -------------
 * `build:dashboard`, `lint` and the GraphQL contract spec prove the documents
 * compile and the fields exist. They do NOT prove that a tenant administrator
 * can actually walk the locked workflow, that the nav renders exactly the five
 * tenant items, or that no React error boundary fires along the way. This script
 * drives a real Chromium over the DevTools Protocol against the running server
 * and asserts on what the SPA actually renders for each persona.
 *
 * PERSONAS
 *   tenant   — a channel-scoped admin: 5 nav items, no org picker, no plumbing,
 *              Room detail tabs, Start/Join, and no sight of another tenant.
 *   platform — holds BBBAdmin/BBBPlatformInfrastructure: additionally sees the
 *              platform section (Organizations/Servers/Capacity/Live
 *              Meetings/Trials) and can browse across tenants.
 *
 * CROSS-TENANT
 *   Two independent layers are checked: the rendered DOM (another tenant's name
 *   must never appear) and the API surface through the tenant's own session
 *   cookie (`bbbRooms(otherOrg)` must be rejected; the no-organizationId
 *   `bbbMeetings` path must return only the caller's own organization).
 *
 * Run (server must already be up with the dashboard built):
 *   npm run build:dashboard && npm run start:server   # or dev:server
 *   BBB_TENANT_USER=... BBB_TENANT_PASSWORD=... \
 *   BBB_PLATFORM_USER=... BBB_PLATFORM_PASSWORD=... \
 *   npm run verify:bbb-dashboard
 *
 * Env:
 *   BBB_DASHBOARD_URL  default http://localhost:3000/dashboard
 *   BBB_ADMIN_API      default http://localhost:3000/admin-api
 *   BBB_TENANT_USER / BBB_TENANT_PASSWORD       (default superadmin creds)
 *   BBB_PLATFORM_USER / BBB_PLATFORM_PASSWORD   (default superadmin creds)
 *   BBB_OTHER_ORG_ID   optional: a second tenant's organization id to probe
 *   CHROME_BIN         override the browser binary
 *   BBB_BROWSER_START_CLASS=0   skip the Start-class click-through
 *   BBB_BROWSER_SHOTS  directory for screenshots (default /tmp/bbb-s6-browser)
 */
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';

const DASHBOARD_URL = process.env.BBB_DASHBOARD_URL ?? 'http://localhost:3000/dashboard';
const ADMIN_API = process.env.BBB_ADMIN_API ?? 'http://localhost:3000/admin-api';
const TENANT_USER = process.env.BBB_TENANT_USER ?? process.env.SUPERADMIN_USERNAME ?? 'superadmin';
const TENANT_PASSWORD = process.env.BBB_TENANT_PASSWORD ?? process.env.SUPERADMIN_PASSWORD ?? 'superadmin';
const PLATFORM_USER = process.env.BBB_PLATFORM_USER ?? TENANT_USER;
const PLATFORM_PASSWORD = process.env.BBB_PLATFORM_PASSWORD ?? TENANT_PASSWORD;
const OTHER_ORG_ID = process.env.BBB_OTHER_ORG_ID ?? '';
const START_CLASS = process.env.BBB_BROWSER_START_CLASS !== '0';
const SHOT_DIR = process.env.BBB_BROWSER_SHOTS ?? '/tmp/bbb-s6-browser';
const DEBUG_PORT = Number(process.env.BBB_DEBUG_PORT ?? 9333);

/** Tokens that must never leak into a tenant document (A11). */
const PLUMBING_TOKENS = [
  'bbbMeetingId',
  'currentMeetingId',
  'retryCount',
  'lastProvisionRequestedAt',
  'Provisioning',
  'grantId',
  'serverId',
];

const TENANT_NAV = ['/bbb/dashboard', '/bbb/rooms', '/bbb/meetings', '/bbb/people', '/bbb/billing'];
const PLATFORM_NAV = [
  '/bbb/organizations',
  '/bbb/servers',
  '/bbb/plans',
  '/bbb/live-meetings',
  '/bbb/trials',
];

interface GqlResult {
  data: any;
  errors?: Array<{ message: string }>;
  cookie?: string;
}

async function gql(
  query: string,
  variables: Record<string, unknown> = {},
  cookie?: string,
  channelToken?: string,
): Promise<GqlResult> {
  const res = await fetch(ADMIN_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie, 'x-apollo-operation-name': 'probe' } : {}),
      // Channel = Tenant (INV-001): the channel token is resolved by Vendure
      // from the request header (`apiOptions.channelTokenKey`, default
      // 'vendure-token'), never from a cookie.
      ...(channelToken ? { 'vendure-token': channelToken } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body: any = await res.json().catch(() => ({}));
  // Merge EVERY Set-Cookie pair into the jar. Vendure signs its session cookie:
  // the server sets `session` AND `session.sig`, and a client that forwards only
  // the first one is treated as anonymous — FORBIDDEN on every guarded operation
  // (same convention as scripts/e2e/graphql-client.ts).
  let session = cookie;
  const setCookieHeaders = res.headers.getSetCookie();
  if (setCookieHeaders.length > 0) {
    const jar = new Map<string, string>();
    for (const pair of (cookie ?? '').split('; ')) {
      const eq = pair.indexOf('=');
      if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    for (const header of setCookieHeaders) {
      const pair = header.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    session = Array.from(jar.entries(), ([k, v]) => `${k}=${v}`).join('; ');
  }
  return { data: body.data, errors: body.errors, cookie: session };
}

// ─── DevTools Protocol client (no new dependency: `ws` ships with Vendure) ────

type CdpMessage = { id?: number; method?: string; params?: any; result?: any; error?: any };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

class Cdp {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private consoleErrors: string[] = [];
  private pageErrors: string[] = [];

  private constructor(private ws: WebSocket) {}

  static async connect(port: number): Promise<Cdp> {
    const deadline = Date.now() + 20_000;
    let target: any;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = (await res.json()) as any[];
        target = targets.find((t) => t.type === 'page');
        if (target?.webSocketDebuggerUrl) break;
      } catch {
        /* browser not listening yet */
      }
      await sleep(250);
    }
    if (!target?.webSocketDebuggerUrl) throw new Error('Chromium DevTools endpoint never came up');

    const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (e) => reject(e as Error));
    });
    const cdp = new Cdp(ws);
    ws.on('message', (raw: any) => cdp.onMessage(JSON.parse(String(raw)) as CdpMessage));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Log.enable');
    return cdp;
  }

  private onMessage(msg: CdpMessage) {
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    // Console/exception capture: a React error boundary firing must fail the run.
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails;
      this.pageErrors.push(String(d?.exception?.description ?? d?.text ?? 'unknown exception'));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      this.consoleErrors.push(
        (msg.params.args ?? [])
          .map((a: any) => String(a.value ?? a.description ?? ''))
          .join(' '),
      );
    }
    if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
      this.consoleErrors.push(String(msg.params.entry.text));
    }
  }

  send(method: string, params?: any): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60_000);
    });
  }
  async evaluate<T = any>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r?.exceptionDetails) {
      throw new Error(
        `evaluate failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`,
      );
    }
    return r?.result?.value as T;
  }

  text(): Promise<string> {
    return this.evaluate<string>('document.body ? document.body.innerText : ""');
  }

  hrefs(): Promise<string[]> {
    return this.evaluate<string[]>(
      'Array.from(document.querySelectorAll("a[href]")).map(a => a.getAttribute("href"))',
    );
  }

  /**
   * Installs every pair of a possibly multi-cookie session string
   * (`session=…; session.sig=…`) — Vendure's signed cookie needs BOTH to
   * authenticate, otherwise the page runs as an anonymous visitor.
   */
  async setSessionCookie(hostname: string, cookie: string): Promise<void> {
    for (const pair of cookie.split('; ')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      await this.send('Network.setCookie', {
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
        domain: hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      });
    }
  }

  async goto(url: string, settleMs = 1500): Promise<void> {
    await this.send('Page.navigate', { url });
    await this.waitFor('document.readyState === "complete"', 30_000);
    await sleep(settleMs);
  }

  /** Polls `expression` (evaluated in the page) until it is truthy. */
  async waitFor(expression: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate<boolean>(`!!(${expression})`)) return true;
      } catch {
        /* page mid-navigation */
      }
      await sleep(250);
    }
    return false;
  }

  async waitForText(needle: string, timeoutMs = 20_000): Promise<boolean> {
    return this.waitFor(
      `document.body && document.body.innerText.includes(${JSON.stringify(needle)})`,
      timeoutMs,
    );
  }

  async clickText(text: string): Promise<boolean> {
    const clicked = await this.evaluate<boolean>(`(() => {
      const els = Array.from(document.querySelectorAll('button, a'));
      const el = els.find(e => (e.textContent || '').trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    await sleep(500);
    return clicked;
  }

  /**
   * Vendure's sidebar collapses each section (Radix collapsible): a collapsed
   * section UNMOUNTS its links, so href-based nav assertions must expand it
   * first. Clicks the exact-title trigger once, then polls for the section's
   * first link.
   */
  async expandSection(title: string, expectPath: string): Promise<boolean> {
    const present = (): Promise<boolean> =>
      this.evaluate<boolean>(
        `Array.from(document.querySelectorAll('a[href]')).some(a => (a.getAttribute('href') || '').includes(${JSON.stringify(expectPath)}))`,
      );
    if (await present()) return true;
    if (!(await this.clickText(title))) return false;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (await present()) return true;
      await sleep(300);
    }
    return false;
  }

  /**
   * Clicks a Room-detail tab WITHOUT touching the sidebar: sidebar anchors
   * ('People', 'Settings') come first in document order and would swallow a
   * naive exact-text click, navigating away from the room. The tab bar is the
   * button row that holds all six locked labels.
   */
  async clickRoomTab(tab: string): Promise<boolean> {
    const clicked = await this.evaluate<boolean>(`(() => {
      const labels = ['Overview', 'People', 'Sessions', 'Attendance', 'Recordings', 'Settings'];
      const buttons = Array.from(document.querySelectorAll('button'));
      const bar = buttons.find(
        b =>
          (b.textContent || '').trim() === 'Overview' &&
          b.parentElement &&
          labels.every(l =>
            Array.from(b.parentElement.querySelectorAll('button')).some(
              x => (x.textContent || '').trim() === l,
            ),
          ),
      );
      if (!bar) return false;
      const target = Array.from(bar.parentElement.querySelectorAll('button')).find(
        x => (x.textContent || '').trim() === ${JSON.stringify(tab)},
      );
      if (!target) return false;
      target.click();
      return true;
    })()`);
    await sleep(600);
    return clicked;
  }

  async screenshot(file: string): Promise<void> {
    try {
      const r = await this.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    } catch {
      /* screenshots are evidence, never a gate */
    }
  }

  problems(): string[] {
    return [...this.pageErrors, ...this.consoleErrors].filter(
      (m) => !/favicon|React DevTools|ResizeObserver/i.test(m),
    );
  }

  clearProblems(): void {
    this.pageErrors = [];
    this.consoleErrors = [];
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

function chromeBinary(): string {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    path.join(os.homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux64/chrome'),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('No Chromium binary found — set CHROME_BIN');
}

function launchBrowser(): ChildProcess {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbb-s6-chrome-'));
  return spawn(
    chromeBinary(),
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1440,1200',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
}

// ─── Assertion framework ────────────────────────────────────────────────────

interface CheckResult {
  ok: boolean;
  detail?: string;
}

const results: Array<{ name: string; status: 'PASS' | 'FAIL' | 'WARN'; detail: string }> = [];

async function check(name: string, fn: () => Promise<CheckResult>): Promise<void> {
  try {
    const r = await fn();
    results.push({ name, status: r.ok ? 'PASS' : 'FAIL', detail: r.detail ?? '' });
    console.log(`  ${r.ok ? '✓' : '✗'} ${name}${r.detail ? ` — ${r.detail}` : ''}`);
  } catch (err) {
    results.push({ name, status: 'FAIL', detail: (err as Error).message });
    console.log(`  ✗ ${name} — ${(err as Error).message}`);
  }
}

function warn(name: string, detail: string): void {
  results.push({ name, status: 'WARN', detail });
  console.log(`  ! ${name} — ${detail}`);
}

const ERROR_BOUNDARY_TEXT = [
  'Something went wrong',
  'Unexpected Application Error',
  'Failed to load',
  'Failed to fetch',
  'is not defined',
];

function boundaryHit(text: string): string | null {
  return ERROR_BOUNDARY_TEXT.find((t) => text.includes(t)) ?? null;
}

function navMismatch(
  hrefs: string[],
  expected: string[],
): { missing: string[]; present: string[] } {
  const joined = hrefs.join(' ');
  return {
    missing: expected.filter((h) => !joined.includes(h)),
    present: expected.filter((h) => joined.includes(h)),
  };
}

/**
 * Any /bbb/ nav link outside the expected set. Nav checks run on landing pages
 * whose main pane carries no /bbb/ links, so an unexpected path here is a nav
 * leak — this is what makes "exactly the five locked items" an actual equality
 * claim instead of a bare presence check.
 */
function bbbNavExtras(hrefs: string[], expected: string[]): string[] {
  const extras = new Set<string>();
  for (const raw of hrefs) {
    const path = raw.replace(/^https?:\/\/[^/]+/, '').replace(/^\/dashboard/, '');
    if (path.startsWith('/bbb/') && !expected.includes(path)) extras.add(path);
  }
  return [...extras];
}

async function openRoute(cdp: Cdp, base: string, route: string, marker: string): Promise<string> {
  await cdp.goto(`${base}${route}`);
  if (!(await cdp.waitForText(marker, 25_000))) {
    // Deep-link fallback: go home and let the app route itself.
    await cdp.goto(base);
    await cdp.waitForText(marker, 15_000);
  }
  return cdp.text();
}

async function firstRoom(
  cookie: string,
  channelToken: string,
  organizationId: string,
): Promise<{ id: string; name: string } | null> {
  const res = await gql(
    'query Probe($org: ID!) { bbbRooms(organizationId: $org) { items { id name } } }',
    { org: organizationId },
    cookie,
    channelToken,
  );
  const item = res.data?.bbbRooms?.items?.[0];
  return item ? { id: String(item.id), name: String(item.name) } : null;
}
// ─── Tenant persona ─────────────────────────────────────────────────────────

async function tenantSuite(
  cdp: Cdp,
  base: string,
  hostname: string,
  cookie: string,
  channelToken: string,
  ownOrgId: string,
  otherOrgId: string,
  otherOrgName: string,
): Promise<void> {
  console.log('\n── Tenant persona (channel-scoped admin) ──────────────────────────');
  await cdp.setSessionCookie(hostname, cookie);
  // Native Vendure channel selection: the dashboard sends the channel token as
  // a header on every Admin API request, so the browser session must do the same.
  await cdp.send('Network.setExtraHTTPHeaders', {
    headers: { 'vendure-token': channelToken },
  });
  cdp.clearProblems();
  await cdp.goto(base);
  await cdp.waitForText('BigBlueButton', 30_000);
  // Sidebar sections start collapsed and a collapsed section unmounts its
  // links — expand ours before any href-based nav assertion.
  await cdp.expandSection('BigBlueButton', '/bbb/dashboard');
  await cdp.screenshot(path.join(SHOT_DIR, 'tenant-01-landing.png'));

  await check('tenant nav shows exactly the five locked items', async () => {
    const hrefs = await cdp.hrefs();
    const { missing } = navMismatch(hrefs, TENANT_NAV);
    const extras = bbbNavExtras(hrefs, TENANT_NAV);
    const ok = missing.length === 0 && extras.length === 0;
    return {
      ok,
      detail: missing.length
        ? `missing ${missing.join(', ')}`
        : extras.length
          ? `extra ${extras.join(', ')}`
          : 'all 5 present, nothing else',
    };
  });

  await check('tenant nav exposes no platform items (A15)', async () => {
    // Actively try to open the platform section too — a tenant must not gain
    // platform links even when the section header exists in the sidebar.
    await cdp.expandSection('BBB Platform', '/bbb/organizations');
    const { present } = navMismatch(await cdp.hrefs(), PLATFORM_NAV);
    return {
      ok: present.length === 0,
      detail: present.length ? `leaked ${present.join(', ')}` : 'none visible',
    };
  });

  const routes: Array<[string, string, string[]]> = [
    ['/bbb/dashboard', 'Dashboard', ['Live now', 'This month', 'Upcoming sessions']],
    ['/bbb/rooms', 'Rooms', ['Create room']],
    ['/bbb/meetings', 'Meetings', ['Billed class history']],
    ['/bbb/people', 'People', ['Trainers', 'Students']],
    ['/bbb/billing', 'Billing', ['Per-room breakdown']],
  ];

  for (const [route, marker, mustContain] of routes) {
    await check(`tenant route ${route} renders`, async () => {
      const text = await openRoute(cdp, base, route, marker);
      const hit = boundaryHit(text);
      await cdp.screenshot(path.join(SHOT_DIR, `tenant${route.replace(/\//g, '_')}.png`));
      if (hit) return { ok: false, detail: `error text "${hit}"` };
      const absent = mustContain.filter((m) => !text.includes(m));
      return {
        ok: absent.length === 0,
        detail: absent.length ? `missing ${absent.join(', ')}` : mustContain.join(', '),
      };
    });
  }

  await check('tenant documents carry no plumbing fields (A11)', async () => {
    let offenders: string[] = [];
    for (const route of ['/bbb/rooms', '/bbb/dashboard', '/bbb/meetings']) {
      const text = await openRoute(cdp, base, route, 'Rooms');
      offenders = offenders.concat(PLUMBING_TOKENS.filter((t) => text.includes(t)));
    }
    return {
      ok: offenders.length === 0,
      detail: offenders.length ? `leaked ${offenders.join(', ')}` : 'none',
    };
  });

  const room = await firstRoom(cookie, channelToken, ownOrgId);

  await check('room detail exposes the six locked tabs', async () => {
    if (!room) return { ok: false, detail: 'tenant has no room — seed one first' };
    const text = await openRoute(cdp, base, `/bbb/rooms/${room.id}`, room.name);
    const tabs = ['Overview', 'People', 'Sessions', 'Attendance', 'Recordings', 'Settings'];
    const missing = tabs.filter((t) => !text.includes(t));
    await cdp.screenshot(path.join(SHOT_DIR, 'tenant-room-detail.png'));
    return {
      ok: missing.length === 0,
      detail: missing.length ? `missing ${missing.join(', ')}` : 'all 6 present',
    };
  });

  const tabExpectations: Array<[string, string]> = [
    ['People', 'Trainers'],
    ['Sessions', 'Scheduled classes for this room'],
    ['Attendance', 'Attendance by class'],
    ['Recordings', 'Recordings'],
    ['Settings', 'Room name'],
  ];

  for (const [tab, marker] of tabExpectations) {
    await check(`room detail tab "${tab}" renders`, async () => {
      if (!room) return { ok: false, detail: 'tenant has no room' };
      // Deep-link back to the room before every click: a naive exact-text
      // click can land on the sidebar ('People', 'Settings' anchors come
      // first in document order) and navigate away — the walk must stay
      // scoped to the room's own six-button tab row.
      await openRoute(cdp, base, `/bbb/rooms/${room.id}`, room.name);
      const clicked = await cdp.clickRoomTab(tab);
      if (!clicked) return { ok: false, detail: 'tab control not found in the room tab bar' };
      const ok = await cdp.waitForText(marker, 15_000);
      const text = await cdp.text();
      await cdp.screenshot(path.join(SHOT_DIR, `tenant-room-tab-${tab.toLowerCase()}.png`));
      const hit = boundaryHit(text);
      if (hit) return { ok: false, detail: `error text "${hit}"` };
      return { ok, detail: ok ? 'ok' : `marker "${marker}" not found` };
    });
  }
  // ─── Start class (real click, real mutation) ──────────────────────────────
  if (START_CLASS) {
    await check('Start class reaches live or starting (never a refusal)', async () => {
      await openRoute(cdp, base, '/bbb/rooms', 'Rooms');
      const clicked = await cdp.clickText('Start class');
      if (!clicked) return { ok: false, detail: 'no Start class button rendered' };
      // Live, still starting, or refused with a tenant-safe message are all
      // correct outcomes (no reachable BBB in most environments); a crash is not.
      await cdp.waitFor(
        `document.body.innerText.includes('Join class') || document.body.innerText.includes('Starting') || document.body.innerText.includes('unavailable') || document.body.innerText.includes('failed')`,
        60_000,
      );
      const text = await cdp.text();
      await cdp.screenshot(path.join(SHOT_DIR, 'tenant-start-class.png'));
      const hit = boundaryHit(text);
      if (hit) return { ok: false, detail: `error text "${hit}"` };
      // The fixture org is pinned to `metered` in main() (see
      // pinOrganizationToMetered), so the legacy grant gate is out of the
      // picture. Start class must therefore reach 'live' (a real BBB server is
      // reachable) or 'starting' (no reachable BBB in this environment, so the
      // provisioning job stays in flight). A refusal is a real failure now:
      // it means the click never reached the provisioning worker.
      const live = text.includes('Join class');
      const starting = !live && /\bStarting\b/.test(text);
      const refused = !live && !starting && /paused|unavailable|could not be started/i.test(text);
      return {
        ok: live || starting,
        detail: live
          ? 'live — moderator join URL issued'
          : starting
            ? 'starting — provisioning in flight (no reachable BBB in this environment)'
            : refused
              ? 'REFUSED — a metered org must not trip the legacy grant gate'
              : 'no start-class outcome marker rendered',
      };
    });
  } else {
    warn('Start class click-through', 'skipped (BBB_BROWSER_START_CLASS=0)');
  }

  // ─── Cross-tenant ─────────────────────────────────────────────────────────
  await check('another tenant never appears in the rendered DOM', async () => {
    if (!otherOrgId) return { ok: true, detail: 'single-tenant database — nothing to compare' };
    const text = `${await openRoute(cdp, base, '/bbb/dashboard', 'Dashboard')}
${await openRoute(cdp, base, '/bbb/rooms', 'Rooms')}`;
    const leaked = !!otherOrgName && text.includes(otherOrgName);
    return { ok: !leaked, detail: leaked ? `rendered "${otherOrgName}"` : 'clean' };
  });

  await check('tenant cannot read another organization\'s rooms (API)', async () => {
    if (!otherOrgId) {
      warn('cross-tenant rooms probe', 'no second organization id available');
      return { ok: true, detail: 'skipped: no second organization' };
    }
    const res = await gql(
      'query Probe($org: ID!) { bbbRooms(organizationId: $org) { totalItems } }',
      { org: otherOrgId },
      cookie,
      channelToken,
    );
    const rejected = (res.errors?.length ?? 0) > 0;
    return {
      ok: rejected,
      detail: rejected
        ? `rejected: ${res.errors![0].message.slice(0, 90)}`
        : 'NOT rejected — isolation breach',
    };
  });

  await check('bbbMeetings with no organizationId stays inside the caller\'s channel (A16)', async () => {
    const res = await gql(
      'query Probe { bbbMeetings { items { id organization { id } } } }',
      {},
      cookie,
      channelToken,
    );
    if (res.errors?.length) return { ok: false, detail: res.errors[0].message.slice(0, 90) };
    const orgIds: string[] = (res.data?.bbbMeetings?.items ?? []).map((i: any) =>
      String(i.organization?.id),
    );
    const foreign = orgIds.filter((id) => id !== ownOrgId);
    return {
      ok: foreign.length === 0,
      detail: foreign.length
        ? `leaked ${foreign.join(', ')}`
        : `${orgIds.length} meeting(s), all in the caller's organization`,
    };
  });

  await check('tenant org list stays inside its own channel (INV-029)', async () => {
    // Not a rejection check: bbbOrganizations is a channel-scoped read by
    // design (bbb-organization.service.findAll — tenant admins see only orgs
    // on their authorized channel; platform callers see all). The invariant is
    // that NO foreign organization ever comes back.
    const res = await gql(
      'query Probe { bbbOrganizations { totalItems items { id } } }',
      {},
      cookie,
      channelToken,
    );
    if (res.errors?.length) return { ok: false, detail: res.errors[0].message.slice(0, 90) };
    const items: any[] = res.data?.bbbOrganizations?.items ?? [];
    const foreign = items.filter((i) => String(i.id) !== ownOrgId);
    return {
      ok: foreign.length === 0,
      detail: foreign.length
        ? `leaked org(s) ${foreign.map((i) => i.id).join(', ')} — isolation breach`
        : `${items.length} org(s), all the caller's own (channel-scoped read)`,
    };
  });

  await check('no uncaught page/console errors during the tenant walkthrough', async () => {
    const problems = cdp.problems();
    return { ok: problems.length === 0, detail: problems.slice(0, 2).join(' | ') };
  });
}

// ─── Platform persona ───────────────────────────────────────────────────────

async function platformSuite(
  cdp: Cdp,
  base: string,
  hostname: string,
  cookie: string,
  channelToken: string,
): Promise<void> {
  console.log('\n── Platform persona (platform operator) ───────────────────────────');
  await cdp.setSessionCookie(hostname, cookie);
  await cdp.send('Network.setExtraHTTPHeaders', {
    headers: { 'vendure-token': channelToken },
  });
  cdp.clearProblems();
  await cdp.goto(base);
  await cdp.waitForText('BigBlueButton', 30_000);
  // Vendure's sidebar keeps only ONE top section open at a time
  // (nav-main's handleTopSectionToggle closes every sibling on open), and both
  // BBB sections are placement:'top' — so they can never coexist in the DOM.
  // Land on the platform section; each nav check then expands its own section.
  await cdp.expandSection('BBB Platform', '/bbb/organizations');
  await cdp.screenshot(path.join(SHOT_DIR, 'platform-01-landing.png'));

  await check('platform nav shows the five platform items', async () => {
    await cdp.expandSection('BBB Platform', '/bbb/organizations');
    const { missing } = navMismatch(await cdp.hrefs(), PLATFORM_NAV);
    return {
      ok: missing.length === 0,
      detail: missing.length ? `missing ${missing.join(', ')}` : 'all 5 present',
    };
  });

  await check('platform keeps the tenant section', async () => {
    // Single-open sidebar: expanding 'BigBlueButton' closes 'BBB Platform' —
    // prove the platform operator still GETS all five tenant items (the nav
    // is not removed for this persona), rather than expecting both at once.
    const opened = await cdp.expandSection('BigBlueButton', '/bbb/dashboard');
    const { missing } = navMismatch(await cdp.hrefs(), TENANT_NAV);
    await cdp.screenshot(path.join(SHOT_DIR, 'platform-02-tenant-section.png'));
    return {
      ok: missing.length === 0,
      detail: missing.length
        ? opened
          ? `missing ${missing.join(', ')}`
          : 'tenant section header not found'
        : 'all 5 present after expand',
    };
  });

  const platformRoutes: Array<[string, string]> = [
    ['/bbb/organizations', 'Organizations'],
    ['/bbb/servers', 'Servers'],
    ['/bbb/plans', 'Capacity'],
    ['/bbb/live-meetings', 'Live Meetings'],
    ['/bbb/trials', 'Trial Registrations'],
  ];

  for (const [route, marker] of platformRoutes) {
    await check(`platform route ${route} renders`, async () => {
      const text = await openRoute(cdp, base, route, marker);
      await cdp.screenshot(path.join(SHOT_DIR, `platform${route.replace(/\//g, '_')}.png`));
      const hit = boundaryHit(text);
      if (hit) return { ok: false, detail: `error text "${hit}"` };
      return {
        ok: text.includes(marker),
        detail: text.includes(marker) ? 'ok' : `"${marker}" not found`,
      };
    });
  }

  await check('platform can list organizations across tenants (API)', async () => {
    const res = await gql('query Probe { bbbOrganizations { totalItems } }', {}, cookie, channelToken);
    if (res.errors?.length) return { ok: false, detail: res.errors[0].message.slice(0, 90) };
    const total = Number(res.data?.bbbOrganizations?.totalItems ?? 0);
    return { ok: total > 0, detail: `${total} organization(s)` };
  });

  await check('platform billing roll-up is reachable (API)', async () => {
    const res = await gql(
      'query Probe($month: String) { bbbPlatformBillingSummary(month: $month) { month totalChargePaise } }',
      { month: new Date().toISOString().slice(0, 7) },
      cookie,
      channelToken,
    );
    if (res.errors?.length) return { ok: false, detail: res.errors[0].message.slice(0, 90) };
    return { ok: true, detail: `month ${res.data?.bbbPlatformBillingSummary?.month}` };
  });

  await check('no uncaught page/console errors during the platform walkthrough', async () => {
    const problems = cdp.problems();
    return { ok: problems.length === 0, detail: problems.slice(0, 2).join(' | ') };
  });
}
// ─── Entry point ────────────────────────────────────────────────────────────

const LOGIN_MUTATION = `mutation LogIn($username: String!, $password: String!) {
  login(username: $username, password: $password) {
    ... on CurrentUser { id identifier }
    ... on ErrorResult { errorCode message }
  }
}`;

async function login(username: string, password: string): Promise<string> {
  const res = await gql(LOGIN_MUTATION, { username, password });
  if (res.errors?.length) throw new Error(`login failed for ${username}: ${res.errors[0].message}`);
  const result = res.data?.login;
  if (!result?.id) {
    throw new Error(
      `login failed for ${username}: ${result?.message ?? result?.errorCode ?? 'unknown'}`,
    );
  }
  if (!res.cookie) {
    throw new Error('login returned no session cookie — tokenMethod must include "cookie"');
  }
  return res.cookie;
}

/** The channel token the persona's own session may operate in (native Vendure). */
async function channelTokenFor(cookie: string): Promise<{ token: string; code: string } | null> {
  const res = await gql('query Probe { me { channels { id code token } } }', {}, cookie);
  const channels: any[] = res.data?.me?.channels ?? [];
  if (!channels.length) return null;
  const preferred = channels.find((c) => c.code !== '__default_channel__') ?? channels[0];
  return { token: String(preferred.token), code: String(preferred.code) };
}

async function ensureRoom(
  cookie: string,
  channelToken: string,
  organizationId: string,
): Promise<{ id: string; name: string; created: boolean }> {
  const existing = await firstRoom(cookie, channelToken, organizationId);
  if (existing) return { ...existing, created: false };
  const name = 'S6 Browser Validation Room';
  const res = await gql(
    `mutation Create($input: CreateBbbRoomInput!) { createBbbRoom(input: $input) { id name } }`,
    { input: { organizationId, name, maxParticipants: 25, recordingEnabled: false } },
    cookie,
    channelToken,
  );
  if (res.errors?.length) {
    throw new Error(`could not create the validation room: ${res.errors[0].message}`);
  }
  return { id: String(res.data?.createBbbRoom?.id), name, created: true };
}

/** Meeting ids this persona can see for one organization (snapshot-diff). */
async function orgMeetingIds(
  cookie: string,
  channelToken: string,
  organizationId: string,
): Promise<Set<string>> {
  const res = await gql(
    'query Probe($org: ID!) { bbbMeetings(organizationId: $org) { items { id } } }',
    { org: organizationId },
    cookie,
    channelToken,
  );
  const items: any[] = res.data?.bbbMeetings?.items ?? [];
  return new Set(items.map((m) => String(m.id)));
}

/**
 * Set the validation organization's billing mode through the platform-gated
 * mutation (ADR-047) and return the mode actually applied.
 *
 * The validation database is seeded by fixtures that INSERT the organization
 * row directly, which bypasses `BbbOrganizationService.create()` and therefore
 * keeps the DDL default `billingMode = 'grant'`. A grant org with no capacity
 * grant refuses every Start class at the provisioning grant gate
 * ("No active capacity grant found for this organization. Please purchase or
 * renew a plan."), so the harness was validating a refusal path that no
 * production tenant reaches. The suite pins the org to `metered` — the
 * ADR-047 / D7 default for new organizations — and restores the original mode
 * afterwards, so a dev database is left exactly as it was found.
 */
async function setOrganizationBilling(
  cookie: string,
  channelToken: string,
  organizationId: string,
  mode: 'grant' | 'metered',
): Promise<string> {
  const res = await gql(
    `mutation SetBilling($id: ID!, $mode: String!) {
       setBbbOrganizationBilling(organizationId: $id, billingMode: $mode, suspended: false) {
         id
         billingMode
       }
     }`,
    { id: organizationId, mode },
    cookie,
    channelToken,
  );
  if (res.errors?.length) {
    throw new Error(`setBbbOrganizationBilling(${mode}) failed: ${res.errors[0].message}`);
  }
  const applied = String(res.data?.setBbbOrganizationBilling?.billingMode ?? '');
  console.log(
    `  billing mode   ${applied}${mode === 'metered' ? ' (pinned for the run)' : ' (restored)'}`,
  );
  return applied;
}

/**
 * Best-effort removal of the meetings THIS run created (Start class creates a
 * real `BbbMeeting` per attempt). Without it the validation room accumulated
 * terminal rows across runs — three orphaned "S6 Browser Validation Room"
 * meetings had piled up by 2026-10-01 — which then dominated the tenant
 * Meetings list on every later run.
 */
async function cleanupMeetingsCreatedSince(
  cookie: string,
  channelToken: string,
  organizationId: string,
  before: Set<string>,
): Promise<void> {
  const after = await orgMeetingIds(cookie, channelToken, organizationId).catch(
    () => new Set<string>(),
  );
  const created = [...after].filter((id) => !before.has(id));
  for (const id of created) {
    // End first (an ACTIVE meeting is not deletable outright), then delete.
    await gql(
      'mutation Cleanup($id: ID!) { endBbbMeeting(id: $id) { id state } }',
      { id },
      cookie,
      channelToken,
    ).catch(() => undefined);
    await gql(
      'mutation Cleanup($id: ID!) { deleteBbbMeeting(id: $id) }',
      { id },
      cookie,
      channelToken,
    ).catch(() => undefined);
  }
  if (created.length) {
    console.log(`\n  cleaned up ${created.length} meeting(s) created by this run`);
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const base = DASHBOARD_URL.replace(/\/+$/, '');
  const hostname = new URL(base).hostname;

  console.log('BBB dashboard browser validation (S6)');
  console.log(`  dashboard   ${base}`);
  console.log(`  admin API   ${ADMIN_API}`);
  console.log(`  screenshots ${SHOT_DIR}`);
  console.log(`  chrome      ${chromeBinary()}`);
  const bbbUrl = process.env.BBB_URL ?? process.env.BBB_SERVER_URL ?? '';
  console.log(
    bbbUrl
      ? `  bbb server  ${bbbUrl}`
      : '  bbb server  NONE configured — Start class is expected to settle at "starting", never "live"',
  );

  const shell = await fetch(base).then((r) => r.text());
  if (!/dashboard|root|app/i.test(shell)) {
    throw new Error(`unexpected dashboard shell at ${base} — is the dashboard built and served?`);
  }
  console.log(`  shell       served (${shell.length} bytes)\n`);

  const platformSession = await login(PLATFORM_USER, PLATFORM_PASSWORD);
  const samePersona = TENANT_USER === PLATFORM_USER && TENANT_PASSWORD === PLATFORM_PASSWORD;
  if (samePersona) {
    // Split personas are the point of this harness: as superadmin the tenant
    // suite would legitimately see the platform nav (A15 then 'leaks').
    console.log(
      '  ⚠ samePersona — tenant suite runs with platform credentials; set BBB_TENANT_USER/_PASSWORD for the split-persona run',
    );
  }
  const tenantSession = samePersona ? platformSession : await login(TENANT_USER, TENANT_PASSWORD);

  const tenantChannel =
    (process.env.BBB_TENANT_CHANNEL_TOKEN
      ? { token: process.env.BBB_TENANT_CHANNEL_TOKEN, code: '(env override)' }
      : await channelTokenFor(tenantSession)) ?? null;
  if (!tenantChannel) throw new Error('the tenant persona exposes no channel to switch into');
  console.log(`  tenant channel ${tenantChannel.code}`);

  const myOrgRes = await gql(
    'query Probe { bbbMyOrganization { id name channelId billingMode } }',
    {},
    tenantSession,
    tenantChannel.token,
  );
  const ownOrg = myOrgRes.data?.bbbMyOrganization;
  if (!ownOrg) throw new Error('bbbMyOrganization returned null for the tenant persona');
  const ownOrgId = String(ownOrg.id);
  console.log(`  tenant org     ${ownOrg.name} (${ownOrgId})`);

  const orgsRes = await gql(
    'query Probe { bbbOrganizations { items { id name channelId } } }',
    {},
    platformSession,
  );
  const orgs: any[] = orgsRes.data?.bbbOrganizations?.items ?? [];
  const otherOrg = orgs.find((o) => String(o.id) !== ownOrgId) ?? null;
  console.log(
    `  platform orgs  ${orgs.length} total${otherOrg ? ` — probing against "${otherOrg.name}"` : ''}`,
  );

  const platformChannel =
    (await channelTokenFor(platformSession).catch(() => null))?.token ?? ownOrg.channelId ?? '';

  // Post-S2 default: new organizations are `metered`, so the grant gate is a
  // dead path. The seeded fixture org keeps the DDL default (`grant`), so pin
  // it — otherwise Start class is refused by the grant gate and the harness
  // validates a refusal no real tenant sees. Restored in the finally block.
  const originalBillingMode = String(ownOrg.billingMode ?? 'grant');
  await setOrganizationBilling(platformSession, tenantChannel.token, ownOrgId, 'metered');

  // Snapshot-diff cleanup for the meetings Start class creates (see
  // cleanupMeetingsCreatedSince).
  const meetingsBefore = await orgMeetingIds(
    tenantSession,
    tenantChannel.token,
    ownOrgId,
  );

  const room = await ensureRoom(tenantSession, tenantChannel.token, ownOrgId);
  console.log(
    `  validation room ${room.name} (${room.id})${room.created ? ' [created]' : ' [existing]'}\n`,
  );

  const browser = launchBrowser();
  let cdp: Cdp | null = null;
  try {
    cdp = await Cdp.connect(DEBUG_PORT);
    await tenantSuite(
      cdp,
      base,
      hostname,
      tenantSession,
      tenantChannel.token,
      ownOrgId,
      otherOrg ? String(otherOrg.id) : OTHER_ORG_ID,
      otherOrg ? String(otherOrg.name) : '',
    );
    await platformSuite(cdp, base, hostname, platformSession, platformChannel);
  } finally {
    cdp?.close();
    browser.kill('SIGKILL');
    await cleanupMeetingsCreatedSince(
      tenantSession,
      tenantChannel.token,
      ownOrgId,
      meetingsBefore,
    );
    // Leave the dev database exactly as found.
    if (originalBillingMode !== 'metered') {
      await setOrganizationBilling(
        platformSession,
        tenantChannel.token,
        ownOrgId,
        originalBillingMode as 'grant' | 'metered',
      ).catch(() => undefined);
    }
    if (room.created) {
      await gql(
        'mutation Cleanup($id: ID!) { deleteBbbRoom(id: $id) }',
        { id: room.id },
        tenantSession,
        tenantChannel.token,
      ).catch(() => undefined);
      console.log(`\n  cleaned up the validation room (${room.id})`);
    }
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  const passed = results.filter((r) => r.status === 'PASS');
  const warned = results.filter((r) => r.status === 'WARN');

  console.log('\n── S6 browser validation summary ──────────────────────────────────');
  for (const r of results) {
    console.log(`  [${r.status}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(`\n  ${passed.length} passed · ${failed.length} failed · ${warned.length} warning(s)`);
  console.log(`  screenshots: ${SHOT_DIR}`);
  if (failed.length) {
    console.error('\nS6 browser validation FAILED');
    process.exitCode = 1;
  } else {
    console.log('\nS6 browser validation PASSED');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nS6 browser validation errored: ${(err as Error).stack ?? err}`);
    process.exit(1);
  });
}

