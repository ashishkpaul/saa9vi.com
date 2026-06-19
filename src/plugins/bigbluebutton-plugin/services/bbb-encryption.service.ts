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
 */
@Injectable()
export class BbbEncryptionService implements OnModuleInit {
  private key: Buffer | null = null;
  private initialized = false;

  onModuleInit() {
    const hex = process.env.BBB_ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) {
      Logger.warn(
        "[BigBlueButtonPlugin] BBB_ENCRYPTION_KEY not set or invalid. " +
          "Encryption will be unavailable until set. " +
          "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        loggerCtx,
      );
      return;
    }
    this.key = Buffer.from(hex, "hex");
    this.initialized = true;
    Logger.info("Encryption key loaded successfully", loggerCtx);
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.key) {
      throw new Error(
        "[BigBlueButtonPlugin] BBB_ENCRYPTION_KEY env variable must be a 64-character hex string. " +
          "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
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

  decrypt(ciphertext: string): string {
    this.ensureInitialized();
    const buf = Buffer.from(ciphertext, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key!, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
  }
}
