import {MigrationInterface, QueryRunner} from "typeorm";

export class AddOrderPaymentPurpose1794398364268 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "tenant_payment_account" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "provider" character varying NOT NULL, "keyId" character varying NOT NULL, "encryptedKeySecret" character varying NOT NULL, "encryptedWebhookSecret" character varying, "accountMode" character varying NOT NULL, "status" character varying NOT NULL, "isEnabled" boolean NOT NULL DEFAULT false, "lastVerifiedAt" TIMESTAMP, "id" SERIAL NOT NULL, CONSTRAINT "PK_cbc81596630a02320b187bc2767" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_c51ee063fb3579a8510ddcc511" ON "tenant_payment_account" ("channelId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_c51ee063fb3579a8510ddcc511"`, undefined);
        await queryRunner.query(`DROP TABLE "tenant_payment_account"`, undefined);
   }

}
