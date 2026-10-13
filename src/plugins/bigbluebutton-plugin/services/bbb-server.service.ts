import { Injectable } from "@nestjs/common";
import {
  ID,
  Logger,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
  UserInputError,
} from "@vendure/core";
import { BbbServer } from "../entities/bbb-server.entity";
import { BbbEncryptionService, BbbCredentialUnreadableError } from "./bbb-encryption.service";
import {
  BbbApiService,
  BbbMisconfiguredError,
  BbbNotFoundError,
  BbbRejectedError,
  BbbUnavailableError,
} from "./bbb-api.service";
import { BbbOpsAlertService } from "./bbb-ops-alert.service";
import { BbbHooksService } from "./bbb-hooks.service";
import { normalizeBbbApiUrl } from "../shared/bbb-api-url";

const loggerCtx = "BbbServerService";

/**
 * Credential status for a BbbServer — surfaced in the Servers UI.
 *
 * OK                  — secret decrypts successfully.
 * CREDENTIAL_UNREADABLE — GCM auth failed on all available keys. Operator
 *                         must re-enter the secret via the Servers UI.
 * UNKNOWN             — secret column was not loaded (select:false).
 */
export type BbbServerCredentialStatus = "OK" | "CREDENTIAL_UNREADABLE" | "UNKNOWN";

export interface CreateBbbServerInput {
  name: string;
  apiUrl: string;
  apiSecret: string;
  maxLoad?: number;
  capacity?: number;
}

export interface UpdateBbbServerInput {
  name?: string;
  apiUrl?: string;
  apiSecret?: string;
  maxLoad?: number;
  capacity?: number;
  enabled?: boolean;
}

@Injectable()
export class BbbServerService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly encryptionService: BbbEncryptionService,
    private readonly ctxService: RequestContextService,
    private readonly bbbApiService: BbbApiService,
    private readonly opsAlert: BbbOpsAlertService,
    private readonly hooksService: BbbHooksService,
  ) {}

  async findAll(
    ctx: RequestContext,
    options?: { skip?: number; take?: number },
  ): Promise<{ items: BbbServer[]; totalItems: number }> {
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const [items, totalItems] = await this.connection
      .getRepository(ctx, BbbServer)
      .findAndCount({
        order: { createdAt: "ASC" },
        skip,
        take,
      });
    return { items, totalItems };
  }

  async findById(ctx: RequestContext, id: ID): Promise<BbbServer | null> {
    return this.connection
      .getRepository(ctx, BbbServer)
      .findOne({ where: { id } });
  }

  /**
   * Returns the server with the encryptedApiSecret field populated.
   * Only use this when you need to make API calls.
   */
  async findByIdWithSecret(
    ctx: RequestContext,
    id: ID,
  ): Promise<BbbServer | null> {
    return this.connection
      .getRepository(ctx, BbbServer)
      .createQueryBuilder("server")
      .addSelect("server.encryptedApiSecret")
      .where("server.id = :id", { id })
      .getOne();
  }

  /**
   * @deprecated Use BbbServerSelectionService.selectServer() instead.
   * Kept for backward compatibility — delegates to the selection service.
   */
  async selectBestServer(ctx: RequestContext): Promise<BbbServer | null> {
    return this.connection
      .getRepository(ctx, BbbServer)
      .createQueryBuilder("server")
      .addSelect("server.encryptedApiSecret")
      .where("server.enabled = :enabled", { enabled: true })
      .andWhere("server.healthy = :healthy", { healthy: true })
      .andWhere("server.currentLoad < server.maxLoad")
      .orderBy("server.currentLoad", "ASC")
      .getOne();
  }

  async create(
    ctx: RequestContext,
    input: CreateBbbServerInput,
  ): Promise<BbbServer> {
    const server = new BbbServer({
      name: input.name,
      apiUrl: normalizeBbbApiUrl(input.apiUrl),
      encryptedApiSecret: this.encryptionService.encrypt(input.apiSecret),
      maxLoad: input.maxLoad ?? 100,
      capacity: input.capacity ?? 200,
    });
    // "Test connection" (Track A item 2): a new row is enabled by default,
    // so it must prove reachability + a working checksum BEFORE it can
    // enter server selection.
    await this.assertReachable(server.apiUrl, server.encryptedApiSecret);
    const saved = await this.connection.getRepository(ctx, BbbServer).save(server);
    // W4: register the webhook hook immediately after creating a server
    // (also runs on the 5-min reconcile, but eager registration avoids
    // missing the first meeting-ended of a freshly added server).
    this.hooksService.ensureWebhook(saved).catch((err) =>
      Logger.warn(
        `W4: ensureWebhook after server create failed for ${saved.id}: ${(err as Error).message}`,
        loggerCtx,
      ),
    );
    return saved;
  }

  async update(
    ctx: RequestContext,
    id: ID,
    input: UpdateBbbServerInput,
  ): Promise<BbbServer> {
    const server = await this.connection.getEntityOrThrow(ctx, BbbServer, id);
    if (input.name !== undefined) server.name = input.name;
    if (input.apiUrl !== undefined)
      server.apiUrl = normalizeBbbApiUrl(input.apiUrl);
    if (input.apiSecret !== undefined) {
      server.encryptedApiSecret = this.encryptionService.encrypt(
        input.apiSecret,
      );
    }
    if (input.maxLoad !== undefined) server.maxLoad = input.maxLoad;
    if (input.capacity !== undefined) server.capacity = input.capacity;
    if (input.enabled !== undefined) server.enabled = input.enabled;
    // "Test connection" (Track A item 2), extended to credential rotation —
    // probe BEFORE persisting any write that can change how this server is
    // called, so a bad candidate never reaches the database:
    //  - `enabled: true` — entering the selection pool (original rule);
    //  - `apiSecret` — the candidate ciphertext must authenticate BEFORE it
    //    replaces the stored one (otherwise a wrong secret persists silently
    //    and only surfaces later as `secret undecryptable` / checksum
    //    failures on every call);
    //  - `apiUrl` — the probe vouches for the COMBINED candidate
    //    (new URL + the supplied secret, or the side-loaded stored one).
    // No probe when the server will be DISABLED after this update
    // (`enabled: false`, or a config edit to an already-disabled row): an
    // operator must be able to stage a server without live BBB reachability.
    // Cosmetic fields (name/maxLoad/capacity) never probe — cheap edits
    // stay cheap.
    const willBeEnabled = input.enabled ?? server.enabled ?? true;
    const touchesRuntimeConfig =
      input.apiSecret !== undefined || input.apiUrl !== undefined;
    if (willBeEnabled && (input.enabled === true || touchesRuntimeConfig)) {
      // getEntityOrThrow does not populate the select:false
      // encryptedApiSecret — use the in-memory candidate when this update
      // supplied a fresh secret (applied above), otherwise side-load the
      // stored ciphertext. Only ever the ciphertext leaves this scope; the
      // plaintext input.apiSecret is encrypted above and never logged.
      let secret = server.encryptedApiSecret;
      if (!secret) {
        secret =
          (await this.findByIdWithSecret(ctx, id))?.encryptedApiSecret ?? "";
      }
      await this.assertReachable(server.apiUrl, secret);
    }
    const saved = await this.connection.getRepository(ctx, BbbServer).save(server);
    // W4: re-register hook when a server is re-enabled.
    if (input.enabled === true) {
      this.hooksService.ensureWebhook(saved).catch((err) =>
        Logger.warn(
          `W4: ensureWebhook after server enable failed for ${saved.id}: ${(err as Error).message}`,
          loggerCtx,
        ),
      );
    }
    return saved;
  }

  async markHealthy(
    ctx: RequestContext,
    id: ID,
    healthy: boolean,
  ): Promise<void> {
    await this.connection.getRepository(ctx, BbbServer).update(id, {
      healthy,
      lastHealthCheckAt: new Date(),
    });
  }

  async delete(ctx: RequestContext, id: ID): Promise<void> {
    // Guard: refuse to delete a server that has linked meeting rows.
    // bbb_meeting.serverId is a FK to bbb_server — deleting the server row
    // with meetings present violates the FK constraint and would also destroy
    // the billing audit trail. Operators should disable the server instead
    // and only delete once all meetings are archived.
    const meetingCount = await this.connection
      .getRepository(ctx, BbbServer)
      .manager.query(
        `SELECT COUNT(*) AS cnt FROM "bbb_meeting" WHERE "serverId" = $1`,
        [id],
      ) as Array<{ cnt: string }>;
    const count = parseInt(meetingCount[0]?.cnt ?? "0", 10);
    if (count > 0) {
      throw new UserInputError(
        `Cannot delete server: ${count} meeting record(s) reference this server. ` +
          `Disable it instead, or archive all linked meetings first.`,
      );
    }
    await this.connection.getRepository(ctx, BbbServer).delete(id);
  }

  /**
   * Returns the credential status for a server by attempting a decrypt.
   * Loads `encryptedApiSecret` (select:false) if not already present.
   * Never throws — returns UNKNOWN if the secret column is unavailable.
   *
   * Used by the GraphQL field resolver for `BbbServer.credentialStatus`.
   */
  async credentialStatus(
    ctx: RequestContext,
    serverId: ID,
  ): Promise<BbbServerCredentialStatus> {
    const server = await this.findByIdWithSecret(ctx, serverId);
    if (!server?.encryptedApiSecret) return "UNKNOWN";
    return this.encryptionService.canDecrypt(server.encryptedApiSecret)
      ? "OK"
      : "CREDENTIAL_UNREADABLE";
  }

  /**
   * "Test connection" (Track A item 2) — signed read-only `getMeetings`
   * against a candidate configuration. Refuses (UserInputError — the
   * dashboard renders it as a toast, nothing is saved) exactly the two
   * failure classes an operator can fix:
   *  - unreachable (BbbUnavailableError: DNS / HTTP 5xx / timeout /
   *    malformed XML);
   *  - checksum rejection (BbbRejectedError with a checksum messageKey —
   *    a wrong apiSecret maps to the checksum key on every call).
   * Any OTHER typed rejection means the server answered AND accepted the
   * checksum (a bad checksum never produces a different key), and
   * BbbNotFoundError likewise proves reachability + auth — both pass
   * with a log line rather than blocking configuration. Misconfigured
   * (missing/undecryptable secret) refuses defensively. W2: the errors
   * are already sanitized (method + host/messageKey only — never the
   * signed URL or the secret).
   */
  private async assertReachable(
    apiUrl: string,
    encryptedApiSecret: string,
  ): Promise<void> {
    const candidate = {
      id: "connection-test",
      name: "connection-test",
      apiUrl,
      encryptedApiSecret,
    } as unknown as BbbServer;
    try {
      await this.bbbApiService.getMeetings(candidate);
      Logger.info("BBB connection test succeeded", loggerCtx);
    } catch (err) {
      if (err instanceof BbbUnavailableError) {
        throw new UserInputError(`BBB server unreachable: ${err.message}`);
      }
      if (err instanceof BbbMisconfiguredError) {
        throw new UserInputError(
          `BBB connection test could not authenticate: ${err.message}`,
        );
      }
      if (err instanceof BbbRejectedError) {
        if (/checksum/i.test(err.messageKey)) {
          throw new UserInputError(
            `BBB checksum rejected — check the API secret: ${err.message}`,
          );
        }
        Logger.warn(
          `BBB connection test answered (non-checksum rejection: ${err.messageKey}) — allowing`,
          loggerCtx,
        );
        return;
      }
      if (err instanceof BbbNotFoundError) {
        Logger.warn(
          "BBB connection test reached the server (method not found) — allowing",
          loggerCtx,
        );
        return;
      }
      throw new UserInputError(
        `BBB connection test failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Periodic signed health probe — `bbb-server-health` task (every 5 min).
   * No health job existed before this (jobs/ held only reconciliation,
   * capacity-alert, daily-allowance, metering and metering-prune), and
   * nothing in the codebase ever wrote `healthy = true`: a single
   * markHealthy(false) from the config/consumption paths was permanent —
   * `updateBbbServer` cannot write `healthy`. This probe is both the
   * detection and the recovery path:
   *
   *  - one signed read-only `getMeetings` per ENABLED server;
   *  - SUCCESS → `healthy = true` (+ `lastHealthCheckAt` stamp) — recovers
   *    a server previously flagged by this probe or by a failure streak;
   *  - ANY typed BBB error (unavailable / rejected / misconfigured /
   *    notFound) → `healthy = false` + de-duplicated ops alert —
   *    `bbb-server-config` for rejected/misconfigured (same family as
   *    flagServerConfigProblem), `bbb-server-health` otherwise. A probe
   *    expects SUCCESS; the next passing probe (≤5 min) restores the
   *    server, and BbbOpsAlertService dedupes so flapping alerts once
   *    per hour per server.
   * Advisory: failures are logged, never thrown — the task cannot be
   * tripped by one bad server.
   */
  async runHealthProbe(): Promise<{
    probed: number;
    flagged: number;
    recovered: number;
  }> {
    const ctx = await this.ctxService.create({ apiType: "admin" });
    const servers = await this.connection
      .getRepository(ctx, BbbServer)
      .createQueryBuilder("server")
      .addSelect("server.encryptedApiSecret")
      .where("server.enabled = :enabled", { enabled: true })
      .getMany();

    let flagged = 0;
    let recovered = 0;
    for (const server of servers) {
      try {
        await this.bbbApiService.getMeetings(server);
        if (!server.healthy) recovered++;
        await this.markHealthy(ctx, server.id, true);
      } catch (err) {
        flagged++;
        await this.markHealthy(ctx, server.id, false);

        // Credential unreadable is its own alert kind — it means the
        // encryption key changed without re-encrypting. The operator fix is
        // to re-enter the secret in the Servers UI (not a BBB connectivity
        // problem).
        const isUnreadable = (err as any)?.isCredentialUnreadable === true;
        const isConfig =
          !isUnreadable &&
          (err instanceof BbbMisconfiguredError || err instanceof BbbRejectedError);

        this.opsAlert.notify(
          isUnreadable
            ? "bbb-credential-unreadable"
            : isConfig
              ? "bbb-server-config"
              : "bbb-server-health",
          `server-${String(server.id)}`,
          isUnreadable
            ? `BBB server "${server.name}" (${String(server.id)}): credential unreadable — ` +
                `re-enter the secret in the Servers UI ` +
                `(key fingerprint: ${this.encryptionService.keyFingerprint})`
            : `BBB health probe failed for "${server.name}": ${(err as Error).message}`.substring(0, 300),
          {
            serverId: String(server.id),
            keyFingerprint: this.encryptionService.keyFingerprint,
            messageKey: (err as { messageKey?: string }).messageKey ?? "unknown",
          },
        );
        Logger.warn(
          isUnreadable
            ? `BBB server ${String(server.id)} credential unreadable ` +
                `(key fingerprint: ${this.encryptionService.keyFingerprint}) — ` +
                "re-enter the secret in the Servers UI"
            : `Health probe failed for BBB server ${String(server.id)}: ${(err as Error).message}`,
          loggerCtx,
        );
      }
    }
    return { probed: servers.length, flagged, recovered };
  }
}
