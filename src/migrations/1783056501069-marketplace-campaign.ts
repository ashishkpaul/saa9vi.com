import {MigrationInterface, QueryRunner} from "typeorm";

export class MarketplaceCampaign1783056501069 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "marketplace_ad_campaign" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "type" character varying NOT NULL DEFAULT 'sponsored_listing', "status" character varying NOT NULL DEFAULT 'draft', "budgetInPaise" integer NOT NULL DEFAULT '0', "spentInPaise" integer NOT NULL DEFAULT '0', "targetSessionId" character varying, "targetSubject" character varying, "targetCity" character varying, "startsAt" TIMESTAMP NOT NULL, "endsAt" TIMESTAMP NOT NULL, "boostWeight" double precision NOT NULL DEFAULT '3', "id" SERIAL NOT NULL, CONSTRAINT "PK_b4a5ecbb7858792f427eabaa402" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_01438f5a57db0d35d370e36587" ON "marketplace_ad_campaign" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "ad_spend_ledger" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "campaignId" character varying NOT NULL, "eventType" character varying NOT NULL, "amountInPaise" integer NOT NULL, "occurredAt" TIMESTAMP NOT NULL, "orderId" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_d979292e4341c499d0122b1d2eb" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b391d4fcf00614bbe35bd592ee" ON "ad_spend_ledger" ("campaignId") `, undefined);
        await queryRunner.query(`CREATE TABLE "ad_wallet" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "balanceInPaise" integer NOT NULL DEFAULT '0', "id" SERIAL NOT NULL, CONSTRAINT "PK_d4d28749c9fe73a6299d82949d9" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0868aba9e7af3771c6719df8ac" ON "ad_wallet" ("channelId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_0868aba9e7af3771c6719df8ac"`, undefined);
        await queryRunner.query(`DROP TABLE "ad_wallet"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b391d4fcf00614bbe35bd592ee"`, undefined);
        await queryRunner.query(`DROP TABLE "ad_spend_ledger"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_01438f5a57db0d35d370e36587"`, undefined);
        await queryRunner.query(`DROP TABLE "marketplace_ad_campaign"`, undefined);
   }

}
