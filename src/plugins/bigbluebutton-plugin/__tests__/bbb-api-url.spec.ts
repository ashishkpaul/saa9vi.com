/**
 * `BbbServer.apiUrl` canonicalisation — save-time AND build-time.
 *
 * Why this exists: operators paste BOTH the canonical base
 * (`https://bbb.example.com/bigbluebutton`, what the entity/README document)
 * and the full API root (`.../bigbluebutton/api`, what the address bar shows
 * after opening a BBB API call), usually with a trailing slash. Every request
 * URL is built as `<apiUrl>/api/<methodName>`, so an un-normalised stored
 * `/api` would produce `.../api/api/create` and 404 every call.
 *
 * The contract (`shared/bbb-api-url.ts`):
 *   - save-time: `BbbServerService.create/update` write the canonical form;
 *   - build-time: `BbbApiService.buildApiUrl/buildJoinUrl` normalise whatever
 *     they load, which is what makes pre-existing rows correct WITHOUT a data
 *     migration and without hand-editing any row (migration governance: no
 *     schema change exists, so no migration is written).
 *
 * THIS FILE pins both halves: the pure function's edge cases, the exact
 * request paths the adapter issues for every stored shape, and the fact that
 * create/update persist the canonical form.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as crypto from "crypto";
import { normalizeBbbApiUrl } from "../shared/bbb-api-url";
import { BbbApiService } from "../services/bbb-api.service";
import { BbbServerService } from "../services/bbb-server.service";
import type { BbbServer } from "../entities/bbb-server.entity";

const BASE = "https://bbb.example.com/bigbluebutton";
const ORIGIN = "https://bbb.example.com";
const SECRET = "url-secret";

const SUCCESS_XML = `<?xml version="1.0"?>
<response><returncode>SUCCESS</returncode><meetingID>m1</meetingID><internalMeetingId>i1</internalMeetingId><running>true</running><participantCount>1</participantCount><moderatorCount>1</moderatorCount><recording>false</recording><startTime>0</startTime><endTime>0</endTime></response>`;

function server(apiUrl: string): BbbServer {
  return { apiUrl, encryptedApiSecret: "enc" } as unknown as BbbServer;
}

function api(): BbbApiService {
  return new BbbApiService({ decrypt: () => SECRET } as never);
}

describe("normalizeBbbApiUrl — the canonicalisation contract", () => {
  it.each<[string, string]>([
    [BASE, BASE], // canonical — untouched
    [`${BASE}/`, BASE], // one trailing slash
    [`${BASE}//`, BASE], // trailing-slash noise
    [`${BASE}/api`, BASE], // full API root pasted
    [`${BASE}/api/`, BASE], // full API root + trailing slash
    [`${BASE}/api///`, BASE], // full API root + slash noise
    ["  https://bbb.example.com/bbb/api  ", "https://bbb.example.com/bbb"], // trim
    ["https://bbb.example.com", "https://bbb.example.com"], // no path at all
    ["https://host/api", "https://host"], // bare /api collapses to the host
    [`${BASE}/api/api`, `${BASE}/api`], // ONE segment (spec: "a trailing /api")
    [`${BASE}/mobile`, `${BASE}/mobile`], // path segments after the base kept
  ])("normalises %s → %s", (input, expected) => {
    expect(normalizeBbbApiUrl(input)).toBe(expected);
  });

  it("is idempotent for every realistic paste shape", () => {
    for (const value of [
      BASE,
      `${BASE}/`,
      `${BASE}/api`,
      `${BASE}/api/`,
      "https://host/api",
    ]) {
      const once = normalizeBbbApiUrl(value);
      expect(normalizeBbbApiUrl(once)).toBe(once);
    }
  });
});

describe("build-time normalisation (legacy rows need no hand-editing)", () => {
  const SHAPES: Array<[string, string]> = [
    ["canonical base", BASE],
    ["trailing slash", `${BASE}/`],
    ["stored /api", `${BASE}/api`],
    ["stored /api/", `${BASE}/api/`],
  ];

  it.each(SHAPES)(
    "buildJoinUrl from a %s → single /api segment",
    (_label, apiUrl) => {
      const url = new URL(
        api().buildJoinUrl(server(apiUrl), {
          fullName: "Learner",
          meetingID: "m1",
          password: "attendee-pw",
        }),
      );
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe("/bigbluebutton/api/join");
      expect(url.pathname).not.toContain("/api/api/");
    },
  );

  it.each(SHAPES)(
    "getMeetingInfo from a %s → single /api segment",
    async (_label, apiUrl) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(SUCCESS_XML, { status: 200 })),
      );
      try {
        await api().getMeetingInfo(server(apiUrl), "m1", "mod-pw");
        const called = vi.mocked(fetch).mock.calls[0]?.[0];
        expect(new URL(String(called)).pathname).toBe(
          "/bigbluebutton/api/getMeetingInfo",
        );
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

describe("save-time normalisation (create/update persist the canonical form)", () => {
  function harness() {
    const save = vi.fn(async (row: unknown) => row);
    const legacyRow = {
      name: "legacy",
      apiUrl: "https://legacy.example.com/bbb/api/",
    };
    const connection = {
      getRepository: vi.fn(() => ({ save })),
      getEntityOrThrow: vi.fn(async () => legacyRow),
    };
    const encryption = { encrypt: vi.fn((value: string) => `enc:${value}`) };
    const service = new BbbServerService(
      connection as never,
      encryption as never,
    );
    return { service, save, legacyRow };
  }

  it("create stores the canonical apiUrl (…/api/ collapses to the base)", async () => {
    const { service, save } = harness();
    await service.create({} as never, {
      name: "primary",
      apiUrl: `${BASE}/api/`,
      apiSecret: "s3cret",
    });
    const saved = save.mock.calls[0]?.[0] as {
      apiUrl: string;
      encryptedApiSecret: string;
    };
    expect(saved.apiUrl).toBe(BASE);
    expect(saved.encryptedApiSecret).toBe("enc:s3cret");
  });

  it("update normalises an explicitly provided apiUrl", async () => {
    const { service, save, legacyRow } = harness();
    await service.update({} as never, "id", {
      apiUrl: " https://legacy.example.com/bbb/api ",
    });
    expect(legacyRow.apiUrl).toBe("https://legacy.example.com/bbb");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("update without apiUrl leaves the stored value untouched (build-time covers reads)", async () => {
    const { service, save, legacyRow } = harness();
    await service.update({} as never, "id", { maxLoad: 42 });
    expect(legacyRow.apiUrl).toBe("https://legacy.example.com/bbb/api/");
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("slash-containing call names (hooks/create-style — W4 ensureWebhook)", () => {
  /**
   * `buildApiUrl` is private because no public method uses a slash-containing
   * methodName yet — the W4 `ensureWebhook` implementation will call it as
   * `hooks/create`. The pin: the method name is appended VERBATIM after a
   * single `/api` segment (normalisation must never eat or duplicate a path
   * segment of a call name), and the checksum covers the FULL slash name.
   */
  function signed(
    apiUrl: string,
    method: string,
    params: Record<string, string>,
  ): URL {
    const svc = api() as unknown as {
      buildApiUrl: (
        s: BbbServer,
        secret: string,
        m: string,
        p: Record<string, string>,
      ) => string;
    };
    return new URL(svc.buildApiUrl(server(apiUrl), SECRET, method, params));
  }

  const HOOK_PARAMS = {
    callbackURL: "https://app.example.com/bbb/webhook/srv-1",
    eventID: "meeting-ended,rap-publish-ended",
  };

  it.each([
    ["canonical base", BASE],
    ["trailing slash", `${BASE}/`],
    ["stored /api", `${BASE}/api`],
    ["stored /api/", `${BASE}/api/`],
  ])("appends hooks/create verbatim after a single /api (%s)", (_label, apiUrl) => {
    const url = signed(apiUrl, "hooks/create", HOOK_PARAMS);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/bigbluebutton/api/hooks/create");
    expect(url.pathname).not.toContain("/api/api/");
  });

  it("checksums the FULL slash name + query + secret (independently recomputed)", () => {
    const url = signed(BASE, "hooks/create", HOOK_PARAMS);
    const qs = new URLSearchParams(HOOK_PARAMS).toString();
    const expected = crypto
      .createHash("sha256")
      .update(`hooks/create${qs}${SECRET}`)
      .digest("hex");
    expect(url.searchParams.get("checksum")).toBe(expected);
    // Param VALUES keep their slash/comma payload untouched.
    expect(url.searchParams.get("callbackURL")).toBe(HOOK_PARAMS.callbackURL);
    expect(url.searchParams.get("eventID")).toBe(
      "meeting-ended,rap-publish-ended",
    );
  });
});
