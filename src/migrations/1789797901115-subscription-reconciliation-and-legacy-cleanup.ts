import {MigrationInterface, QueryRunner} from "typeorm";

export class SubscriptionReconciliationAndLegacyCleanup1789797901115 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "subscription_reconciliation_required" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "providerOrderId" character varying NOT NULL, "invoiceId" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'PENDING', "resolutionNote" character varying, "detectedAt" TIMESTAMP NOT NULL, "id" SERIAL NOT NULL, "subscriptionId" integer NOT NULL, CONSTRAINT "PK_07be6b290928e1c3c22f1bd46ee" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_5873498e4b3b03a79d872715ac" ON "subscription_reconciliation_required" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_498d7780160fb13e4b818309e2" ON "subscription_reconciliation_required" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "subscription_reconciliation_required" ADD CONSTRAINT "FK_f4c6bb43e25f0045b6c0da5bc83" FOREIGN KEY ("subscriptionId") REFERENCES "organization_subscription"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);

        // ------------------------------------------------------------------
        // Legacy Juspay table cleanup (ADR-040: Legacy Juspay Table Cleanup).
        //
        // The six Juspay entities were deleted from the source tree in commit
        // 9a31beb ("refactor(subscription): make recurring billing
        // provider-neutral"). Deleting an @Entity does NOT drop its table, and
        // TypeORM 0.3.31's RdbmsSchemaBuilder has no table-drop capability
        // (no dropRemovedTables(), no `removedTables` metadata, no
        // TableRemoved event), so `vendure migrate --generate` can never emit
        // these statements. This is the documented .clinerules §7 exception.
        //
        // Read-only inspection of the deployed database on 2026-09-19 showed
        // all six tables contain 0 rows (exact COUNT(*)), and no views,
        // materialized views or other objects depend on them, so DROP (not
        // rename + data migration) is the correct strategy: there is no
        // operational history to preserve.
        //
        // Drop order is dependency-aware:
        //   juspay_subscription_mandate_channels_channel
        //       -> FK to juspay_subscription_mandate(id)
        //       -> FK to channel(id)
        //   all other five tables are mutually independent.
        // ------------------------------------------------------------------
        await queryRunner.query(`DROP TABLE "juspay_subscription_mandate_channels_channel"`, undefined);
        await queryRunner.query(`DROP TABLE "juspay_payment_attempt"`, undefined);
        await queryRunner.query(`DROP TABLE "juspay_payment_reconciliation_required"`, undefined);
        await queryRunner.query(`DROP TABLE "juspay_webhook_event"`, undefined);
        await queryRunner.query(`DROP TABLE "juspay_webhook_endpoint"`, undefined);
        await queryRunner.query(`DROP TABLE "juspay_subscription_mandate"`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        // ------------------------------------------------------------------
        // Restore the six legacy Juspay tables so this migration is fully
        // reversible (ADR-040). Definitions below are a faithful
        // reconstruction of the deployed public-schema shape captured by
        // read-only catalog queries (pg_attribute / pg_constraint /
        // pg_indexes) on 2026-09-19, immediately before the drops in up().
        // They are NOT re-derived from the deleted entity classes.
        //
        // Recreated in dependency order: the three tables carrying an FK to
        // organization_subscription first, then the two independent tables,
        // then the join table last (it references juspay_subscription_mandate
        // and channel).
        //
        // down() restores structure only. The tables were empty when dropped
        // (0 rows), so there is no row data to restore.
        // ------------------------------------------------------------------

        // 1. juspay_subscription_mandate
        await queryRunner.query(`CREATE TABLE "juspay_subscription_mandate" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "juspayCustomerId" character varying NOT NULL, "mandateId" character varying, "status" character varying NOT NULL DEFAULT 'pending', "activatedAt" TIMESTAMP, "revokedAt" TIMESTAMP, "id" SERIAL NOT NULL, "subscriptionId" integer NOT NULL, CONSTRAINT "PK_cdc30064c777110389aa9595e07" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_subscription_mandate" ADD CONSTRAINT "FK_5c15d252b2759f8c1de816edfcd" FOREIGN KEY ("subscriptionId") REFERENCES "organization_subscription"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_73ae6749569d4977ad59aeae73" ON "juspay_subscription_mandate" ("channelId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e2b2245131f526d370d3a680cf" ON "juspay_subscription_mandate" ("subscriptionId") WHERE ((status)::text <> 'revoked'::text)`, undefined);

        // 2. juspay_payment_attempt
        await queryRunner.query(`CREATE TABLE "juspay_payment_attempt" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "invoiceId" character varying NOT NULL, "billingPeriodStart" character varying(10) NOT NULL, "amountPaise" integer NOT NULL, "status" character varying NOT NULL DEFAULT 'initiated', "juspayOrderId" character varying, "juspayTransactionId" character varying, "failureReason" character varying, "attemptedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "subscriptionId" integer NOT NULL, "channelId" character varying NOT NULL, CONSTRAINT "PK_3db740b2051114f1bc47191723f" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_payment_attempt" ADD CONSTRAINT "FK_04b2d73997890966a2f51c030ca" FOREIGN KEY ("subscriptionId") REFERENCES "organization_subscription"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_7cae5f43963b0c1410eef53be0" ON "juspay_payment_attempt" ("juspayTransactionId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_c4d104a2865448ab2caacbc078" ON "juspay_payment_attempt" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_d6c59d31dfe92e309ea16364c5" ON "juspay_payment_attempt" ("subscriptionId", "attemptedAt") `, undefined);

        // 3. juspay_payment_reconciliation_required
        await queryRunner.query(`CREATE TABLE "juspay_payment_reconciliation_required" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "juspayOrderId" character varying NOT NULL, "invoiceId" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'PENDING', "resolutionNote" character varying, "detectedAt" TIMESTAMP NOT NULL, "id" SERIAL NOT NULL, "subscriptionId" integer NOT NULL, CONSTRAINT "PK_8f49b6e1364d0d7116eb9b428ff" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_payment_reconciliation_required" ADD CONSTRAINT "FK_91340451ef3bf4e2a577785ef58" FOREIGN KEY ("subscriptionId") REFERENCES "organization_subscription"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_0844a0aeb0ab229ba3eedecc4e" ON "juspay_payment_reconciliation_required" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_9bf0a660b10954f7e971c62d94" ON "juspay_payment_reconciliation_required" ("status") `, undefined);

        // 4. juspay_webhook_endpoint
        await queryRunner.query(`CREATE TABLE "juspay_webhook_endpoint" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "token" character varying(64) NOT NULL, "channelId" character varying NOT NULL, "basicAuthUsername" character varying(128) NOT NULL, "basicAuthPassword" character varying(256) NOT NULL, "hmacSecret" character varying(256) NOT NULL, "hmacSecretVersion" character varying(16), "enabled" boolean NOT NULL DEFAULT true, "id" SERIAL NOT NULL, "encryptionKeyVersion" integer NOT NULL DEFAULT 1, CONSTRAINT "PK_ac5d131c38bd1d27daaaa514270" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_dd7a9676543ee80580c2b5027f" ON "juspay_webhook_endpoint" ("channelId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e8bc9b8af7c1672156e6376444" ON "juspay_webhook_endpoint" ("token") `, undefined);

        // 5. juspay_webhook_event
        await queryRunner.query(`CREATE TABLE "juspay_webhook_event" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "dedupeKey" character varying(512) NOT NULL, "eventName" character varying(128) NOT NULL, "payload" jsonb NOT NULL, "status" character varying NOT NULL DEFAULT 'PENDING', "processedAt" TIMESTAMP, "failureReason" character varying, "receivedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "channelId" character varying NOT NULL, CONSTRAINT "PK_ab249b4ad4a084a5ef4023fe09b" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_70aaea4e28ae9ebe4327bf88ee" ON "juspay_webhook_event" ("status") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_a197c9815a68aded184e0a8c7e9" ON "juspay_webhook_event" ("dedupeKey") `, undefined);

        // 6. juspay_subscription_mandate_channels_channel (join table)
        await queryRunner.query(`CREATE TABLE "juspay_subscription_mandate_channels_channel" ("juspaySubscriptionMandateId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_de5a70f6b1f9ec19553b736c989" PRIMARY KEY ("juspaySubscriptionMandateId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_57f2ade546c4f1f619870643ab" ON "juspay_subscription_mandate_channels_channel" ("juspaySubscriptionMandateId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_e39d8ec2048843d7123633d2c5" ON "juspay_subscription_mandate_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_subscription_mandate_channels_channel" ADD CONSTRAINT "FK_57f2ade546c4f1f619870643abb" FOREIGN KEY ("juspaySubscriptionMandateId") REFERENCES "juspay_subscription_mandate"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_subscription_mandate_channels_channel" ADD CONSTRAINT "FK_e39d8ec2048843d7123633d2c5a" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);

        // ------------------------------------------------------------------
        // Reverse the CLI-generated portion of up().
        // ------------------------------------------------------------------
        await queryRunner.query(`ALTER TABLE "subscription_reconciliation_required" DROP CONSTRAINT "FK_f4c6bb43e25f0045b6c0da5bc83"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_498d7780160fb13e4b818309e2"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_5873498e4b3b03a79d872715ac"`, undefined);
        await queryRunner.query(`DROP TABLE "subscription_reconciliation_required"`, undefined);
   }

}
