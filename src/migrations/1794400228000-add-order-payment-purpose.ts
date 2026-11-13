import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrderPaymentPurpose1794400228000 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
       await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsPaymentpurpose" character varying(255)`, undefined);
       await queryRunner.query(`CREATE TABLE "tenant_payment_account" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "provider" character varying NOT NULL, "keyId" character varying NOT NULL, "encryptedKeySecret" character varying NOT NULL, "encryptedWebhookSecret" character varying, "accountMode" character varying NOT NULL, "status" character varying NOT NULL, "isEnabled" boolean NOT NULL DEFAULT false, "lastVerifiedAt" TIMESTAMP, "id" SERIAL NOT NULL, CONSTRAINT "PK_tenant_payment_account" PRIMARY KEY ("id"))`, undefined);
       await queryRunner.query(`CREATE INDEX "IDX_tenant_payment_account_channelId" ON "tenant_payment_account" ("channelId") `, undefined);
       await queryRunner.query(`CREATE UNIQUE INDEX "IDX_tenant_payment_account_channel_provider" ON "tenant_payment_account" ("channelId", "provider") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
       await queryRunner.query(`DROP INDEX "public"."IDX_tenant_payment_account_channel_provider"`, undefined);
       await queryRunner.query(`DROP INDEX "public"."IDX_tenant_payment_account_channelId"`, undefined);
       await queryRunner.query(`DROP TABLE "tenant_payment_account"`, undefined);
       await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsPaymentpurpose"`, undefined);
   }

}