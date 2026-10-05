/**
 * W7 — checksum algorithm as an adapter option.
 *
 * The adapter used to hardcode SHA-256. BBB servers advertise their accepted
 * set via `supportedChecksumAlgorithms` (W0: `bbb-conf --version` on the
 * deployed server), so the algorithm is now the `checksumAlgorithm` plugin
 * option — default `sha256`, with `sha1` for legacy servers.
 *
 * The SIGNATURE ITSELF is pinned here against known-answer vectors per
 * algorithm, so no refactor can silently change what the server is asked to
 * verify:
 *
 *   checksum = hex( <alg>( methodName + queryString + apiSecret ) )
 *
 * Vectors computed independently of the adapter (node crypto) for the fixed
 * input `getMeetingInfo` + `meetingID=m1&password=mod-pw` + `w7-secret`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as crypto from "crypto";
import { BbbApiService } from "../services/bbb-api.service";
import type { BbbServer } from "../entities/bbb-server.entity";
import type { BigBlueButtonPluginOptions } from "../types";

const SECRET = "w7-secret";
const HOST = "https://bbb.example.com/bigbluebutton";
const METHOD = "getMeetingInfo";
const PARAMS: Record<string, string> = { meetingID: "m1", password: "mod-pw" };
/** node crypto over `METHOD + URLSearchParams(PARAMS) + SECRET`. */
const SHA256_VECTOR =
  "2a93a0e94d917f900d4806586081d9041d810aef725d4b038c2545136efbc851";
const SHA1_VECTOR = "f4ec5162b3840ff3fd8a8ac6b27218d6a9439291";

const SUCCESS_XML = `<?xml version="1.0"?>
<response><returncode>SUCCESS</returncode><meetingID>m1</meetingID><internalMeetingID>i1</internalMeetingID><running>true</running><participantCount>1</participantCount><moderatorCount>1</moderatorCount><recording>false</recording><startTime>0</startTime><endTime>0</endTime></response>`;

function server(): BbbServer {
  return { apiUrl: HOST, encryptedApiSecret: "enc" } as unknown as BbbServer;
}

function api(options?: BigBlueButtonPluginOptions): BbbApiService {
  return new BbbApiService({ decrypt: () => SECRET } as never, options);
}

/** Runs getMeetingInfo against a faked fetch; returns the signed URL. */
async function signedUrl(
  options?: BigBlueButtonPluginOptions,
): Promise<URL> {
  vi.mocked(fetch).mockResolvedValue(
    new Response(SUCCESS_XML, { status: 200 }),
  );
  await api(options).getMeetingInfo(server(), PARAMS.meetingID, PARAMS.password);
  const called = vi.mocked(fetch).mock.calls[0]?.[0];
  expect(called, "getMeetingInfo never issued a request").toBeTruthy();
  return new URL(String(called));
}

describe("W7 — checksum algorithm adapter option", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("defaults to SHA-256 (the frozen production signature)", async () => {
    const url = await signedUrl();
    expect(url.searchParams.get("checksum")).toBe(SHA256_VECTOR);
  });

  it("explicit 'sha256' signs identically to the default", async () => {
    const url = await signedUrl({ checksumAlgorithm: "sha256" });
    expect(url.searchParams.get("checksum")).toBe(SHA256_VECTOR);
  });

  it("'sha1' signs with the SHA-1 vector (legacy servers)", async () => {
    const url = await signedUrl({ checksumAlgorithm: "sha1" });
    expect(url.searchParams.get("checksum")).toBe(SHA1_VECTOR);
    expect(url.searchParams.get("checksum")).not.toBe(SHA256_VECTOR);
  });

  it("unknown algorithm values fall back to SHA-256 (never a broken signature)", async () => {
    const url = await signedUrl({ checksumAlgorithm: "md5" as never });
    expect(url.searchParams.get("checksum")).toBe(SHA256_VECTOR);
  });

  it("the signature covers method + params + secret, in that order", async () => {
    const url = await signedUrl({ checksumAlgorithm: "sha1" });
    const qs = new URLSearchParams(PARAMS).toString();
    const recomputed = crypto
      .createHash("sha1")
      .update(METHOD + qs + SECRET)
      .digest("hex");
    expect(url.searchParams.get("checksum")).toBe(recomputed);
    // ...and NOT the other orderings a refactor might introduce.
    expect(recomputed).not.toBe(
      crypto.createHash("sha1").update(SECRET + METHOD + qs).digest("hex"),
    );
  });

  it("buildJoinUrl honours the same option (join is signed through the same path)", () => {
    const join = api({ checksumAlgorithm: "sha1" }).buildJoinUrl(server(), {
      fullName: "Learner",
      meetingID: "m1",
      password: "attendee-pw",
    });
    const url = new URL(join);
    const qs = new URLSearchParams({
      fullName: "Learner",
      meetingID: "m1",
      password: "attendee-pw",
    }).toString();
    expect(url.searchParams.get("checksum")).toBe(
      crypto.createHash("sha1").update("join" + qs + SECRET).digest("hex"),
    );
  });
});