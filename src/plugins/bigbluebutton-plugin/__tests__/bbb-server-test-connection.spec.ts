/**
 * Track A item 2 — "Test connection" validation on server create/enable.
 *
 * Covered:
 *  (T1) create + unreachable → UserInputError, row NOT saved;
 *  (T2) create + checksum rejection → UserInputError, row NOT saved;
 *  (T3) create + SUCCESS → saved, probe ran against the NORMALIZED base
 *       URL with the encrypted secret;
 *  (T4) create + non-checksum rejection → allowed (checksum evidently
 *       accepted — a wrong secret always maps to the checksum key);
 *  (T5) update {enabled:true} without a new secret → side-loads the
 *       stored secret for the probe; unreachable → refused, not saved;
 *  (T6) update without `enabled` → no probe (cheap config edits stay cheap);
 *  (T7) update {enabled:true} + SUCCESS → saved enabled.
 */
import { describe, expect, it, vi } from "vitest";
import { UserInputError } from "@vendure/core";
import { BbbServerService } from "../services/bbb-server.service";
import {
  BbbRejectedError,
  BbbUnavailableError,
} from "../services/bbb-api.service";

const CTX = { apiType: "admin" } as never;
const BASE = "https://bbb.example.com/bigbluebutton";

function harness(opts: {
  api?: { getMeetings: ReturnType<typeof vi.fn> };
  /** Simulates getEntityOrThrow's select:false row (no secret column). */
  row?: Record<string, unknown>;
  /** What the findByIdWithSecret side-load returns. */
  sideLoadedSecret?: string;
} = {}) {
  const save = vi.fn(async (s: unknown) => s);
  const row = opts.row ?? {
    id: "id",
    name: "legacy",
    apiUrl: "https://old.example.com/bbb/api/",
  };
  const qb: any = {
    addSelect: () => qb,
    where: () => qb,
    getOne: async () => ({
      ...row,
      encryptedApiSecret: opts.sideLoadedSecret ?? "enc:old",
    }),
  };
  const connection = {
    getEntityOrThrow: vi.fn(async () => row),
    getRepository: () => ({ save, createQueryBuilder: () => qb }),
  };
  const encryption = { encrypt: vi.fn((v: string) => `enc:${v}`) };
  const api = opts.api ?? { getMeetings: vi.fn(async () => []) };
  const service = new BbbServerService(
    connection as never,
    encryption as never,
    { create: async () => CTX } as never,
    api as never,
    {} as never, // opsAlert — unused by the connection test
  );
  return { service, save, api, row, encryption };
}

describe("Test connection on create (assertReachable)", () => {
  it("(T1) unreachable → UserInputError, nothing saved", async () => {
    const getMeetings = vi.fn(async () => {
      throw new BbbUnavailableError("create", "request failed (bbb)");
    });
    const { service, save } = harness({ api: { getMeetings } });

    await expect(
      service.create(CTX, {
        name: "prod",
        apiUrl: `${BASE}/api/`,
        apiSecret: "s3cret",
      }),
    ).rejects.toThrow(UserInputError);
    await expect(
      service.create(CTX, { name: "p", apiUrl: BASE, apiSecret: "s" }),
    ).rejects.toThrow(/unreachable/);
    expect(save).not.toHaveBeenCalled();
  });

  it("(T2) checksum rejection → UserInputError about the secret, nothing saved", async () => {
    const getMeetings = vi.fn(async () => {
      throw new BbbRejectedError("create", "checksumError", "bad checksum");
    });
    const { service, save } = harness({ api: { getMeetings } });

    const err = await service
      .create(CTX, { name: "prod", apiUrl: BASE, apiSecret: "wrong" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(UserInputError);
    expect((err as Error).message).toMatch(/checksum rejected/i);
    expect(save).not.toHaveBeenCalled();
  });

  it("(T3) SUCCESS → saved; probe used the normalized base + encrypted secret", async () => {
    const { service, save, api } = harness();

    await service.create(CTX, {
      name: "prod",
      apiUrl: `${BASE}/api/`,
      apiSecret: "s3cret",
    });

    expect(api.getMeetings).toHaveBeenCalledTimes(1);
    expect(api.getMeetings).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: BASE,
        encryptedApiSecret: "enc:s3cret",
      }),
    );
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("(T4) non-checksum rejection → allowed (server answered + authed)", async () => {
    const getMeetings = vi.fn(async () => {
      throw new BbbRejectedError("create", "unsupported", "method missing");
    });
    const { service, save } = harness({ api: { getMeetings } });

    await service.create(CTX, {
      name: "prod",
      apiUrl: BASE,
      apiSecret: "s3cret",
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("Test connection on enable (update)", () => {
  it("(T5) enable without a new secret → side-loads it; unreachable refuses", async () => {
    const getMeetings = vi.fn(async () => {
      throw new BbbUnavailableError("getMeetings", "request failed (bbb)");
    });
    const { service, save } = harness({
      api: { getMeetings },
      row: { id: "id", name: "legacy", apiUrl: BASE },
      sideLoadedSecret: "enc:stored-secret",
    });

    await expect(
      service.update(CTX, "id", { enabled: true }),
    ).rejects.toThrow(/unreachable/);
    // The probe authenticated with the STORED secret (select:false side-load).
    expect(getMeetings).toHaveBeenCalledWith(
      expect.objectContaining({ encryptedApiSecret: "enc:stored-secret" }),
    );
    // Refused → nothing persisted (the row object is mutated in memory,
    // but save — the only path to the database — never ran).
    expect(save).not.toHaveBeenCalled();
  });

  it("(T6) update without `enabled` → no probe (config edits stay cheap)", async () => {
    const { service, save, api } = harness();

    await service.update(CTX, "id", { maxLoad: 42 });

    expect(api.getMeetings).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("(T7) enable + SUCCESS → saved enabled", async () => {
    const { service, save, api } = harness({
      row: { id: "id", name: "legacy", apiUrl: BASE },
      sideLoadedSecret: "enc:stored-secret",
    });

    const result = await service.update(CTX, "id", { enabled: true });

    expect(api.getMeetings).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.enabled).toBe(true);
  });
});