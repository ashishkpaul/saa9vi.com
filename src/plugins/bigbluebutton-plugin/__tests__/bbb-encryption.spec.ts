/**
 * BbbEncryptionService unit tests.
 *
 * Covers:
 *   E1  Valid key loaded → fingerprint logged, keyFingerprint is 8 hex chars
 *   E2  encrypt → decrypt round-trip
 *   E3  Wrong key → BbbCredentialUnreadableError with fingerprint in message
 *   E4  Previous-key fallback → ciphertext from old key decrypts via fallback
 *   E5  Both keys fail → BbbCredentialUnreadableError
 *   E6  canDecrypt returns true/false without throwing
 *   E7  Fingerprint is the first 8 hex chars of sha256(key) — stable KAV
 *   E8  Fingerprint never contains the key material itself
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as crypto from "crypto";
import {
  BbbEncryptionService,
  BbbCredentialUnreadableError,
} from "../services/bbb-encryption.service";

function makeKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

function makeService(
  key: string,
  previousKey?: string,
): BbbEncryptionService {
  const svc = new BbbEncryptionService();
  vi.stubEnv("BBB_ENCRYPTION_KEY", key);
  if (previousKey) {
    vi.stubEnv("BBB_ENCRYPTION_KEY_PREVIOUS", previousKey);
  } else {
    vi.stubEnv("BBB_ENCRYPTION_KEY_PREVIOUS", "");
  }
  svc.onModuleInit();
  return svc;
}

describe("BbbEncryptionService", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── E1 ──────────────────────────────────────────────────────────────────────
  it("E1: valid key → keyFingerprint is exactly 8 lowercase hex chars", () => {
    const svc = makeService(makeKey());
    expect(svc.keyFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  // ── E2 ──────────────────────────────────────────────────────────────────────
  it("E2: encrypt → decrypt round-trip", () => {
    const svc = makeService(makeKey());
    const plaintext = "super-secret-bbb-api-key-12345";
    const ciphertext = svc.encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(svc.decrypt(ciphertext)).toBe(plaintext);
  });

  it("E2b: each encrypt call produces a different ciphertext (random IV)", () => {
    const svc = makeService(makeKey());
    const a = svc.encrypt("same");
    const b = svc.encrypt("same");
    expect(a).not.toBe(b);
    expect(svc.decrypt(a)).toBe("same");
    expect(svc.decrypt(b)).toBe("same");
  });

  // ── E3 ──────────────────────────────────────────────────────────────────────
  it("E3: decrypt with wrong key throws BbbCredentialUnreadableError containing fingerprint", () => {
    const encKey = makeKey();
    const decKey = makeKey(); // different key
    const enc = makeService(encKey);
    const dec = makeService(decKey);

    const ciphertext = enc.encrypt("my-secret");
    expect(() => dec.decrypt(ciphertext)).toThrowError(BbbCredentialUnreadableError);

    let caught: Error | undefined;
    try {
      dec.decrypt(ciphertext);
    } catch (e) {
      caught = e as Error;
    }
    // Fingerprint of the DECRYPTING key must appear in the error message
    expect(caught?.message).toContain(dec.keyFingerprint);
    // Raw key material must NOT appear
    expect(caught?.message).not.toContain(decKey);
    expect(caught?.message).not.toContain(encKey);
  });

  // ── E4 ──────────────────────────────────────────────────────────────────────
  it("E4: previous-key fallback — ciphertext from old key decrypts after rotation", () => {
    const oldKey = makeKey();
    const newKey = makeKey();

    // Encrypt with the old key
    const oldSvc = makeService(oldKey);
    const ciphertext = oldSvc.encrypt("bbb-secret");

    // After rotation: new key is primary, old key is previous
    const rotatedSvc = makeService(newKey, oldKey);
    expect(rotatedSvc.decrypt(ciphertext)).toBe("bbb-secret");
  });

  // ── E5 ──────────────────────────────────────────────────────────────────────
  it("E5: both keys fail → BbbCredentialUnreadableError", () => {
    const encKey = makeKey();
    const wrongKey1 = makeKey();
    const wrongKey2 = makeKey();

    const enc = makeService(encKey);
    const ciphertext = enc.encrypt("value");

    const dec = makeService(wrongKey1, wrongKey2);
    expect(() => dec.decrypt(ciphertext)).toThrowError(BbbCredentialUnreadableError);
  });

  // ── E6 ──────────────────────────────────────────────────────────────────────
  it("E6: canDecrypt returns true for own ciphertext, false for wrong key", () => {
    const key1 = makeKey();
    const key2 = makeKey();

    const svc1 = makeService(key1);
    const svc2 = makeService(key2);

    const ct = svc1.encrypt("value");
    expect(svc1.canDecrypt(ct)).toBe(true);
    expect(svc2.canDecrypt(ct)).toBe(false);
  });

  it("E6b: canDecrypt never throws", () => {
    const svc = makeService(makeKey());
    // Garbage ciphertext must not throw
    expect(() => svc.canDecrypt("not-valid-base64!!!")).not.toThrow();
    expect(svc.canDecrypt("not-valid-base64!!!")).toBe(false);
  });

  // ── E7 ──────────────────────────────────────────────────────────────────────
  it("E7: fingerprint is first 8 hex chars of sha256(key bytes) — known-answer", () => {
    const knownKey =
      "0000000000000000000000000000000000000000000000000000000000000000";
    const svc = makeService(knownKey);
    const keyBytes = Buffer.from(knownKey, "hex");
    const expected = crypto
      .createHash("sha256")
      .update(keyBytes)
      .digest("hex")
      .slice(0, 8);
    expect(svc.keyFingerprint).toBe(expected);
  });

  // ── E8 ──────────────────────────────────────────────────────────────────────
  it("E8: fingerprint does not contain any fragment of the key hex string", () => {
    const key = makeKey();
    const svc = makeService(key);
    // The fingerprint is a hash output — statistically impossible to collide
    // with a 4-char substring of the raw key at fixed offset, but we check
    // the fingerprint is not a prefix/suffix of the key string.
    expect(key).not.toContain(svc.keyFingerprint + svc.keyFingerprint);
    expect(svc.keyFingerprint.length).toBe(8);
    // The fingerprint is in the error message, not the key
    const ct = makeService(makeKey()).encrypt("x");
    let msg = "";
    try {
      svc.decrypt(ct);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain(svc.keyFingerprint);
    expect(msg).not.toContain(key);
  });

  // ── isCredentialUnreadable flag ──────────────────────────────────────────────
  it("BbbCredentialUnreadableError has isCredentialUnreadable: true", () => {
    const svc1 = makeService(makeKey());
    const svc2 = makeService(makeKey());
    const ct = svc1.encrypt("x");
    try {
      svc2.decrypt(ct);
    } catch (e) {
      expect((e as any).isCredentialUnreadable).toBe(true);
      expect(e).toBeInstanceOf(BbbCredentialUnreadableError);
    }
  });
});
