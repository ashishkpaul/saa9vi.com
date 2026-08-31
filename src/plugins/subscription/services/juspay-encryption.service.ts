import { Injectable, OnModuleInit } from "@nestjs/common";
import { Logger } from "@vendure/core";
import * as crypto from "crypto";

const loggerCtx = "JuspayEncryptionService";

/**
 * AES-256-GCM encryption/decryption for Juspay webhook secrets at rest.
 *
 * Mirrors BBB_ENCRYPTION_KEY discipline (see BbbEncryptionService): a 64-char
 * hex string (32 bytes). The SAME key is used — Juspay secrets are the same
 * sensitivity class as BBB API passwords, and sharing the key avoids a second
 * secret in the environment.
 *
 * Format: base64(iv || authTag || ciphertext). 12-byte IV, 16-byte GCM tag.
 *
 * Step 6 hardening: webhook credentials (basicAuthPassword, hmacSecret) are
 * encrypted BEFORE persisting to JuspayWebhookEndpoint and decrypted on read
 * for verification. Plaintext never touches the database.
 */
@Injectable()
export class JuspayEncryptionService implements OnModuleInit {
    private key: Buffer | null = null;

    onModuleInit() {
        const hex = process.env.BBB_ENCRYPTION_KEY;
        if (!hex || hex.length !== 64) {
            Logger.warn(
                "[SubscriptionPlugin] BBB_ENCRYPTION_KEY not set or invalid — Juspay webhook secrets will NOT be encrypted at rest. Set a 64-char hex key.",
                loggerCtx,
            );
            return;
        }
        this.key = Buffer.from(hex, "hex");
        Logger.info("Juspay webhook encryption key loaded", loggerCtx);
    }

    /**
     * Returns true when encryption is available. When false, the endpoint
     * service refuses to store secrets (fail-closed: plaintext persistence
     * is not allowed in production).
     */
    isAvailable(): boolean {
        return this.key !== null;
    }

    encrypt(plaintext: string): string {
        this.ensureReady();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", this.key!, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, encrypted]).toString("base64");
    }

    decrypt(ciphertext: string): string {
        this.ensureReady();
        const buf = Buffer.from(ciphertext, "base64");
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const encrypted = buf.subarray(28);
        const decipher = crypto.createDecipheriv("aes-256-gcm", this.key!, iv);
        decipher.setAuthTag(tag);
        return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
    }

    private ensureReady(): void {
        if (!this.key) {
            throw new Error(
                "[SubscriptionPlugin] Juspay webhook secret encryption requested but BBB_ENCRYPTION_KEY is not available. Refusing to store plaintext secrets.",
            );
        }
    }
}
