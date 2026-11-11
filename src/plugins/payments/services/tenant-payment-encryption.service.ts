import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

const loggerCtx = 'TenantPaymentEncryptionService';

/**
 * AES-256-GCM encryption/decryption for tenant Razorpay credentials.
 *
 * Requires TENANT_PAYMENT_ENCRYPTION_KEY env variable: a 64-char hex string (32 bytes).
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * The key is validated lazily — on first encrypt() or decrypt() call —
 * so the app boots successfully even if the key is not set.
 *
 * Key rotation: Set TENANT_PAYMENT_ENCRYPTION_KEY to the new key. If
 * TENANT_PAYMENT_ENCRYPTION_KEY_PREVIOUS is set, decrypt() falls back to it
 * when the primary key produces a GCM auth failure.
 */
@Injectable()
export class TenantPaymentEncryptionService implements OnModuleInit {
  private key: Buffer | null = null;
  private previousKey: Buffer | null = null;
  private initialized = false;

  keyFingerprint: string = '(none)';

  onModuleInit() {
    const hex = process.env.TENANT_PAYMENT_ENCRYPTION_KEY;
    const valid = !!hex && hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex);
    if (valid) {
      this.key = Buffer.from(hex!, 'hex');
      this.initialized = true;
      this.keyFingerprint = this.fingerprintOf(this.key);

      const prevHex = process.env.TENANT_PAYMENT_ENCRYPTION_KEY_PREVIOUS;
      const prevValid =
        !!prevHex && prevHex.length === 64 && /^[0-9a-fA-F]+$/.test(prevHex);
      if (prevValid) {
        this.previousKey = Buffer.from(prevHex!, 'hex');
        Logger.warn(
          `Tenant payment encryption key loaded (fingerprint ${this.keyFingerprint}). ` +
            `Previous key also loaded (fingerprint ${this.fingerprintOf(this.previousKey)}) — ` +
            'fallback decryption active. Remove TENANT_PAYMENT_ENCRYPTION_KEY_PREVIOUS ' +
            'once all rows have been re-encrypted.',
          loggerCtx,
        );
      } else {
        Logger.log(
          `Tenant payment encryption key loaded (fingerprint ${this.keyFingerprint})`,
          loggerCtx,
        );
      }
      return;
    }
    if (process.env.APP_ENV !== 'dev') {
      throw new Error(
        '[TenantPaymentEncryptionService] TENANT_PAYMENT_ENCRYPTION_KEY is missing or invalid ' +
          '(APP_ENV is not "dev"). Refusing to start: tenant credential encryption ' +
          'would fail. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    Logger.warn(
      '[TenantPaymentEncryptionService] TENANT_PAYMENT_ENCRYPTION_KEY not set or invalid. ' +
        'Encryption will be unavailable until set. ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      loggerCtx,
    );
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.key) {
      throw new Error(
        '[TenantPaymentEncryptionService] TENANT_PAYMENT_ENCRYPTION_KEY env variable must be a 64-character hex string. ' +
          'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
  }

  private fingerprintOf(key: Buffer): string {
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
  }

  /** Encrypt a plaintext secret. Returns base64(iv + tag + ciphertext). */
  encrypt(plaintext: string): string {
    this.ensureInitialized();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key!, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  /**
   * Decrypt ciphertext. Tries the current key first; if GCM auth fails and
   * TENANT_PAYMENT_ENCRYPTION_KEY_PREVIOUS is set, retries with the previous key.
   * Throws when both keys fail.
   */
  decrypt(ciphertext: string): string {
    this.ensureInitialized();
    try {
      return this.decryptWith(ciphertext, this.key!);
    } catch (primary) {
      if (this.previousKey) {
        try {
          return this.decryptWith(ciphertext, this.previousKey);
        } catch {
          // Both keys failed — fall through.
        }
      }
      throw new Error(
        `AES-256-GCM authentication failed — credential encrypted with an unknown key ` +
          `(active key fingerprint: ${this.keyFingerprint}). Re-enter the secret in the ` +
          'Payment Gateways UI.',
      );
    }
  }

  private decryptWith(ciphertext: string, key: Buffer): string {
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }

  /** Returns true if the ciphertext can be decrypted with any available key. */
  canDecrypt(ciphertext: string): boolean {
    try {
      this.decrypt(ciphertext);
      return true;
    } catch {
      return false;
    }
  }
}