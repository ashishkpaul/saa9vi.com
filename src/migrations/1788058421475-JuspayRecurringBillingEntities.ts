import {MigrationInterface, QueryRunner} from "typeorm";

export class JuspayRecurringBillingEntities1788058421475 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "juspay_subscription_mandate" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "juspayCustomerId" character varying NOT NULL, "mandateId" character varying, "status" character varying NOT NULL DEFAULT 'pending', "activatedAt" TIMESTAMP, "revokedAt" TIMESTAMP, "id" SERIAL NOT NULL, "subscriptionId" integer NOT NULL, CONSTRAINT "PK_cdc30064c777110389aa9595e07" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_73ae6749569d4977ad59aeae73" ON "juspay_subscription_mandate" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "juspay_payment_attempt" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "invoiceId" character varying NOT NULL, "billingPeriodStart" character varying(10) NOT NULL, "amountPaise" integer NOT NULL, "status" character varying NOT NULL DEFAULT 'initiated', "juspayOrderId" character varying, "juspayTransactionId" character varying, "failureReason" character varying, "attemptedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "subscriptionId" integer NOT NULL, CONSTRAINT "PK_3db740b2051114f1bc47191723f" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_7cae5f43963b0c1410eef53be0" ON "juspay_payment_attempt" ("juspayTransactionId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_d6c59d31dfe92e309ea16364c5" ON "juspay_payment_attempt" ("subscriptionId", "attemptedAt") `, undefined);
        await queryRunner.query(`CREATE TABLE "juspay_webhook_event" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "dedupeKey" character varying(512) NOT NULL, "eventName" character varying(128) NOT NULL, "payload" jsonb NOT NULL, "status" character varying NOT NULL DEFAULT 'PENDING', "processedAt" TIMESTAMP, "failureReason" character varying, "receivedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, CONSTRAINT "UQ_a197c9815a68aded184e0a8c7e9" UNIQUE ("dedupeKey"), CONSTRAINT "PK_ab249b4ad4a084a5ef4023fe09b" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_70aaea4e28ae9ebe4327bf88ee" ON "juspay_webhook_event" ("status") `, undefined);
        await queryRunner.query(`CREATE TABLE "juspay_subscription_mandate_channels_channel" ("juspaySubscriptionMandateId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_de5a70f6b1f9ec19553b736c989" PRIMARY KEY ("juspaySubscriptionMandateId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_57f2ade546c4f1f619870643ab" ON "juspay_subscription_mandate_channels_channel" ("juspaySubscriptionMandateId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_e39d8ec2048843d7123633d2c5" ON "juspay_subscription_mandate_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_subscription_mandate" ADD CONSTRAINT "FK_5c15d252b2759f8c1de816edfcd" FOREIGN KEY ("subscriptionId") REFERENCES "organization_subscription"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_payment_attempt" ADD CONSTRAINT "FK_04b2d73997890966a2f51c030ca" FOREIGN KEY ("subscriptionId") REFERENCES "organization_subscription"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_subscription_mandate_channels_channel" ADD CONSTRAINT "FK_57f2ade546c4f1f619870643abb" FOREIGN KEY ("juspaySubscriptionMandateId") REFERENCES "juspay_subscription_mandate"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_subscription_mandate_channels_channel" ADD CONSTRAINT "FK_e39d8ec2048843d7123633d2c5a" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "juspay_subscription_mandate_channels_channel" DROP CONSTRAINT "FK_e39d8ec2048843d7123633d2c5a"`, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_subscription_mandate_channels_channel" DROP CONSTRAINT "FK_57f2ade546c4f1f619870643abb"`, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_payment_attempt" DROP CONSTRAINT "FK_04b2d73997890966a2f51c030ca"`, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_subscription_mandate" DROP CONSTRAINT "FK_5c15d252b2759f8c1de816edfcd"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e39d8ec2048843d7123633d2c5"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_57f2ade546c4f1f619870643ab"`, undefined);
        await queryRunner.query(`DROP TABLE "juspay_subscription_mandate_channels_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_70aaea4e28ae9ebe4327bf88ee"`, undefined);
        await queryRunner.query(`DROP TABLE "juspay_webhook_event"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_d6c59d31dfe92e309ea16364c5"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_7cae5f43963b0c1410eef53be0"`, undefined);
        await queryRunner.query(`DROP TABLE "juspay_payment_attempt"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_73ae6749569d4977ad59aeae73"`, undefined);
        await queryRunner.query(`DROP TABLE "juspay_subscription_mandate"`, undefined);
   }

}
