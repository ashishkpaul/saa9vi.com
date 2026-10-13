import { Injectable, OnModuleInit } from "@nestjs/common";
import { Logger } from "@vendure/core";
import * as crypto from "crypto";

const loggerCtx = "BbbEncryptionService";

/**
 * AES-256-GCM encryption/decryption for sensitive BBB credentials.
 *
 * Requires BBB_ENCRYPTION_KEY env variable: a 64-char hex string (32 bytes).
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * The key is validated lazily — on first encrypt() or decrypt() call —
 * so the app boots successfully even if BBB_ENCRYPTION_KEY is not set.
 * This allows other plugins to work independently.
 *
 * Key rotation (DA-003):
 *   Set BBB_ENCRYPTION_KEY to the new key. If BBB_ENCRYPTION_KEY_PREVIOUS is
 *   set, decrypt() falls back to it when the primary key produces a GCM auth
 *   failure. This allows zero-downtime rotation: old ciphertext decrypts via
 *   the previous key while new encryptions use the current key. After all rows
 *   have been re-encrypted (via the re-encrypt admin command), remove
 *   BBB_ENCRYPTION_KEY_PREVIOUS.
 */
@Injectable()
export class BbbEncryptionService implements OnModuleInit {
  private key: Buffer | null = null;
  private previousKey: Buffer | null = null;
  private initialized = false;

  /** 8-hex-char fingerprint of the active key for log/alert context (never the full key). */
  keyFingerprint: string = "(none)";

  onModuleInit() {
    const hex = process.env.BBB_ENCRYPTION_KEY;
    const valid = !!hex && hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex);
    if (valid) {
      this.key = Buffer.from(hex!, "hex");
      this.initialized = true;
      this.keyFingerprint = this.fingerprintOf(this.key);

      const prevHex = process.env.BBB_ENCRYPTION_KEY_PREVIOUS;
      const prevValid =
        !!prevHex && prevHex.length === 64 && /^[0-9a-fA-F]+$/.test(prevHex);
      if (prevValid) {
        this.previousKey = Buffer.from(prevHex!, "hex");
        Logger.warn(
          `Encryption key loaded (fingerprint ${this.keyFingerprint}). ` +
            `Previous key also loaded (fingerprint ${this.fingerprintOf(this.previousKey)}) — ` +
            "fallback decryption active. Remove BBB_ENCRYPTION_KEY_PREVIOUS " +
            "once all rows have been re-encrypted.",
          loggerCtx,
        );
      } else {
        Logger.info(
          `Encryption key loaded (fingerprint ${this.keyFingerprint})`,
          loggerCtx,
        );
      }
      return;
    }
    if (process.env.APP_ENV !== "dev") {
      throw new Error(
        "[BigBlueButtonPlugin] BBB_ENCRYPTION_KEY is missing or invalid " +
          "(APP_ENV is not \"dev\"). Refusing to start: provisioning would " +
          "create BBB meetings that can never be stored. Generate with: " +
          "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    Logger.warn(
      "[BigBlueButtonPlugin] BBB_ENCRYPTION_KEY not set or invalid. " +
        "Encryption will be unavailable until set. " +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      loggerCtx,
    );
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.key) {
      throw new Error(
        "[BigBlueButtonPlugin] BBB_ENCRYPTION_KEY env variable must be a 64-character hex string. " +
          "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
  }

  /** SHA-256 of the key bytes, first 8 hex chars — safe to log. */
  private fingerprintOf(key: Buffer): string {
    return crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
  }

  encrypt(plaintext: string): string {
    this.ensureInitialized();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key!, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString("base64");
  }

  /**
   * Decrypt ciphertext. Tries the current key first; if GCM auth fails and
   * BBB_ENCRYPTION_KEY_PREVIOUS is set, retries with the previous key.
   *
   * Throws `BbbCredentialUnreadableError` (a subclass of Error with
   * `isCredentialUnreadable: true`) when both keys fail, so callers can
   * surface the "re-enter secret" status without catching generic errors.
   */
  decrypt(ciphertext: string): string {
    this.ensureInitialized();
    try {
      return this.decryptWith(ciphertext, this.key!);
    } catch (primary) {
      // GCM tag mismatch → try previous key if available.
      if (this.previousKey) {
        try {
          return this.decryptWith(ciphertext, this.previousKey);
        } catch {
          // Both keys failed — fall through to throw below.
        }
      }
      throw new BbbCredentialUnreadableError(
        `AES-256-GCM authentication failed — credential encrypted with an ` +
          `unknown key (active key fingerprint: ${this.keyFingerprint}). ` +
          `Re-enter the secret in the Servers UI or set BBB_ENCRYPTION_KEY_PREVIOUS ` +
          `if you rotated the key without re-encrypting.`,
      );
    }
  }

  private decryptWith(ciphertext: string, key: Buffer): string {
    const buf = Buffer.from(ciphertext, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
  }

  /**
   * Returns true if the ciphertext can be decrypted with the current key
   * (or previous key if set). Used by BbbServerService to surface
   * CREDENTIAL_UNREADABLE status without throwing.
   */
  canDecrypt(ciphertext: string): boolean {
    try {
      this.decrypt(ciphertext);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Thrown when decrypt() fails GCM authentication on all available keys.
 * Callers (BbbServerService, BbbWebhookController, BbbApiService) can
 * `instanceof` check this to surface the "re-enter secret" UI status.
 */
export class BbbCredentialUnreadableError extends Error {
  readonly isCredentialUnreadable = true as const;
  constructor(message: string) {
    super(message);
    this.name = "BbbCredentialUnreadableError";
  }
}
