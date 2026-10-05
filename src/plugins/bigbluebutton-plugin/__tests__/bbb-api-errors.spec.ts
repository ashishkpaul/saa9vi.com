/**
 * W1+W2 — BBB adapter hardening: typed errors + secret sanitization.
 *
 * W1: `getMeetingInfo` returned `null` for EVERY failure — reconciliation
 * treated `null` as "meeting destroyed" and staled live meetings on outages.
 * Now: BbbNotFoundError = proven gone; BbbUnavailableError/BbbRejectedError =
 * skip, never stale. W2: no error/span may contain checksum=/password/secret.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BbbApiService,
  BbbNotFoundError,
  BbbRejectedError,
  BbbUnavailableError,
  bbbRejected,
} from "../services/bbb-api.service";
import type { BbbServer } from "../entities/bbb-server.entity";

const SECRET = "test-secret-that-must-never-leak";
const HOST = "https://bbb.example.com/bigbluebutton";

function server(): BbbServer {
  return { apiUrl: HOST, encryptedApiSecret: "enc" } as unknown as BbbServer;
}

function api(): BbbApiService {
  return new BbbApiService({ decrypt: () => SECRET } as never);
}

function xmlResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

const SUCCESS_INFO = `<?xml version="1.0"?>
<response><returncode>SUCCESS</returncode><meetingID>m1</meetingID>
<internalMeetingID>i1</internalMeetingID><running>true</running>
<participantCount>5</participantCount><moderatorCount>2</moderatorCount>
<recording>false</recording><startTime>0</startTime><endTime>0</endTime></response>`;

const NOTFOUND = `<?xml version="1.0"?>
<response><returncode>FAILED</returncode><messageKey>notFound</messageKey>
<message>We could not find a meeting with that meeting ID</message></response>`;

const CHECKSUM_FAILED = `<?xml version="1.0"?>
<response><returncode>FAILED</returncode><messageKey>checksumError</messageKey>
<message>You did not pass the checksum security check</message></response>`;

const LEAK_TOKENS = ["checksum=", "password", "PW", SECRET];

function expectSanitized(err: unknown): string {
  const msg = (err as Error).message;
  for (const token of LEAK_TOKENS) {
    expect(msg, `error message leaks ${token}`).not.toContain(token);
  }
  return msg;
}

describe("BbbApiService typed errors (W1) + sanitization (W2)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps notFound FAILED to BbbNotFoundError (sanitized)", async () => {
    vi.mocked(fetch).mockResolvedValue(xmlResponse(NOTFOUND));
    const err = await api()
      .getMeetingInfo(server(), "m1", "mod-pw")
      .catch((e) => e);
    expect(err).toBeInstanceOf(BbbNotFoundError);
    expectSanitized(err);
  });

  it("maps checksum FAILED to BbbRejectedError (keeps messageKey)", async () => {
    vi.mocked(fetch).mockResolvedValue(xmlResponse(CHECKSUM_FAILED));
    const err = await api()
      .getMeetingInfo(server(), "m1", "mod-pw")
      .catch((e) => e);
    expect(err).toBeInstanceOf(BbbRejectedError);
    expect((err as BbbRejectedError).messageKey).toBe("checksumError");
    expectSanitized(err);
  });

  it("maps HTTP 500 to BbbUnavailableError (sanitized)", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("oops", { status: 500 }));
    const err = await api()
      .getMeetingInfo(server(), "m1", "mod-pw")
      .catch((e) => e);
    expect(err).toBeInstanceOf(BbbUnavailableError);
    const msg = expectSanitized(err);
    expect(msg).toContain("HTTP 500");
  });

  it("maps timeout/abort to BbbUnavailableError (sanitized)", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    vi.mocked(fetch).mockRejectedValue(abortErr);
    const err = await api()
      .getMeetingInfo(server(), "m1", "mod-pw")
      .catch((e) => e);
    expect(err).toBeInstanceOf(BbbUnavailableError);
    expectSanitized(err);
  });

  it("maps DNS failure to BbbUnavailableError without echoing URL", async () => {
    vi.mocked(fetch).mockRejectedValue(
      new Error(
        `fetch failed: ${HOST}/api/getMeetingInfo?meetingID=m1&password=secretpw&checksum=abc123`,
      ),
    );
    const err = await api()
      .getMeetingInfo(server(), "m1", "mod-pw")
      .catch((e) => e);
    expect(err).toBeInstanceOf(BbbUnavailableError);
    expectSanitized(err);
  });

  it("maps malformed XML to BbbUnavailableError (sanitized)", async () => {
    vi.mocked(fetch).mockResolvedValue(xmlResponse("not xml <<<"));
    const err = await api()
      .getMeetingInfo(server(), "m1", "mod-pw")
      .catch((e) => e);
    expect(err).toBeInstanceOf(BbbUnavailableError);
    expectSanitized(err);
  });

  it("returns info on SUCCESS and sends the moderator password", async () => {
    vi.mocked(fetch).mockResolvedValue(xmlResponse(SUCCESS_INFO));
    const info = await api().getMeetingInfo(server(), "m1", "mod-pw");
    expect(info.meetingID).toBe("m1");
    expect(info.participantCount).toBe(5);
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("password=mod-pw");
  });

  it("getRecordings throws typed errors instead of returning []", async () => {
    vi.mocked(fetch).mockResolvedValue(xmlResponse(NOTFOUND));
    const err = await api()
      .getRecordings(server(), "m1")
      .catch((e) => e);
    expect(err).toBeInstanceOf(BbbNotFoundError);
    expectSanitized(err);
  });

  it("bbbRejected maps notFound vs other keys", () => {
    expect(bbbRejected("getMeetingInfo", "notFound", "gone")).toBeInstanceOf(
      BbbNotFoundError,
    );
    const r = bbbRejected("create", "checksumError", "bad checksum");
    expect(r).toBeInstanceOf(BbbRejectedError);
    expect((r as BbbRejectedError).messageKey).toBe("checksumError");
    expectSanitized(r);
  });
});
