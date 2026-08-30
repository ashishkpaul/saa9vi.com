import {MigrationInterface, QueryRunner} from "typeorm";

export class JuspayMultiTenantWebhookEndpoints1788065585269 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "juspay_webhook_endpoint" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "token" character varying(64) NOT NULL, "channelId" character varying NOT NULL, "basicAuthUsername" character varying(128) NOT NULL, "basicAuthPassword" character varying(256) NOT NULL, "hmacSecret" character varying(256) NOT NULL, "hmacSecretVersion" character varying(16), "enabled" boolean NOT NULL DEFAULT true, "id" SERIAL NOT NULL, CONSTRAINT "PK_ac5d131c38bd1d27daaaa514270" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_dd7a9676543ee80580c2b5027f" ON "juspay_webhook_endpoint" ("channelId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e8bc9b8af7c1672156e6376444" ON "juspay_webhook_endpoint" ("token") `, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_webhook_event" ADD "channelId" character varying NOT NULL`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "juspay_webhook_event" DROP COLUMN "channelId"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e8bc9b8af7c1672156e6376444"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_dd7a9676543ee80580c2b5027f"`, undefined);
        await queryRunner.query(`DROP TABLE "juspay_webhook_endpoint"`, undefined);
   }

}
