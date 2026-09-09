import {MigrationInterface, QueryRunner} from "typeorm";

export class AddProviderWebhookEvent1788942410706 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "subscription_provider_binding" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "provider" character varying NOT NULL, "providerSubscriptionId" character varying NOT NULL, "providerPlanId" character varying, "providerStatus" character varying NOT NULL, "active" boolean NOT NULL DEFAULT false, "metadata" json, "id" SERIAL NOT NULL, "subscriptionId" integer NOT NULL, CONSTRAINT "PK_bd0161a85316d128a57919fc144" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_49baf63fef2c73c93f626a409d" ON "subscription_provider_binding" ("provider", "providerSubscriptionId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_e580dcb42469ceff39dc20679b" ON "subscription_provider_binding" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "subscription_billing_attempt" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "provider" character varying NOT NULL, "providerSubscriptionId" character varying, "providerPaymentId" character varying, "providerInvoiceId" character varying, "providerEventId" character varying, "amountPaise" integer NOT NULL, "currency" character varying NOT NULL, "billingPeriodStart" character varying(10) NOT NULL, "status" character varying NOT NULL DEFAULT 'initiated', "failureReason" character varying, "attemptedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "subscriptionId" integer NOT NULL, CONSTRAINT "PK_814669f7079f84baaf0b3b0a041" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b8f64963b5adfd82ca6d97911b" ON "subscription_billing_attempt" ("providerEventId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_5cbf08c0b79fe4dc46ea3de04d" ON "subscription_billing_attempt" ("subscriptionId", "attemptedAt") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_a5a3c3ebd5f2f4744182dbc3cb" ON "subscription_billing_attempt" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "provider_webhook_event" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "provider" character varying NOT NULL, "providerEventId" character varying NOT NULL, "eventType" character varying NOT NULL, "payloadHash" character varying NOT NULL, "rawPayload" json NOT NULL, "receivedAt" TIMESTAMP NOT NULL DEFAULT now(), "verifiedAt" TIMESTAMP, "processedAt" TIMESTAMP, "processingStatus" character varying NOT NULL DEFAULT 'pending', "errorMessage" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_45b1f1155afa5e804fb65d6c3aa" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_ffa7a1ea1c840491bbaace28ce" ON "provider_webhook_event" ("processingStatus") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_759a6376a901f027d4a130bc5e" ON "provider_webhook_event" ("provider", "providerEventId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_6e1b826a441537e192f4173da1" ON "provider_webhook_event" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "subscription_provider_binding_channels_channel" ("subscriptionProviderBindingId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_953e98a25f30cbaf6f0280a2691" PRIMARY KEY ("subscriptionProviderBindingId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_d7cd69327c939511edb4474244" ON "subscription_provider_binding_channels_channel" ("subscriptionProviderBindingId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b0065005d8d3fc429ebd651863" ON "subscription_provider_binding_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "subscription_provider_binding" ADD CONSTRAINT "FK_1a5beb03beee37bd8c2dae16175" FOREIGN KEY ("subscriptionId") REFERENCES "organization_subscription"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "subscription_billing_attempt" ADD CONSTRAINT "FK_cd0e9c776dc9b5e19fabcf2ec73" FOREIGN KEY ("subscriptionId") REFERENCES "organization_subscription"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "subscription_provider_binding_channels_channel" ADD CONSTRAINT "FK_d7cd69327c939511edb4474244b" FOREIGN KEY ("subscriptionProviderBindingId") REFERENCES "subscription_provider_binding"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "subscription_provider_binding_channels_channel" ADD CONSTRAINT "FK_b0065005d8d3fc429ebd6518639" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "subscription_provider_binding_channels_channel" DROP CONSTRAINT "FK_b0065005d8d3fc429ebd6518639"`, undefined);
        await queryRunner.query(`ALTER TABLE "subscription_provider_binding_channels_channel" DROP CONSTRAINT "FK_d7cd69327c939511edb4474244b"`, undefined);
        await queryRunner.query(`ALTER TABLE "subscription_billing_attempt" DROP CONSTRAINT "FK_cd0e9c776dc9b5e19fabcf2ec73"`, undefined);
        await queryRunner.query(`ALTER TABLE "subscription_provider_binding" DROP CONSTRAINT "FK_1a5beb03beee37bd8c2dae16175"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b0065005d8d3fc429ebd651863"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_d7cd69327c939511edb4474244"`, undefined);
        await queryRunner.query(`DROP TABLE "subscription_provider_binding_channels_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_6e1b826a441537e192f4173da1"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_759a6376a901f027d4a130bc5e"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_ffa7a1ea1c840491bbaace28ce"`, undefined);
        await queryRunner.query(`DROP TABLE "provider_webhook_event"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_a5a3c3ebd5f2f4744182dbc3cb"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_5cbf08c0b79fe4dc46ea3de04d"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b8f64963b5adfd82ca6d97911b"`, undefined);
        await queryRunner.query(`DROP TABLE "subscription_billing_attempt"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e580dcb42469ceff39dc20679b"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_49baf63fef2c73c93f626a409d"`, undefined);
        await queryRunner.query(`DROP TABLE "subscription_provider_binding"`, undefined);
   }

}
