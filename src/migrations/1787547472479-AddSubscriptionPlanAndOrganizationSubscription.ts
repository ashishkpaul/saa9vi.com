import {MigrationInterface, QueryRunner} from "typeorm";

export class AddSubscriptionPlanAndOrganizationSubscription1787547472479 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "subscription_plan" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "slug" character varying NOT NULL, "description" character varying, "monthlyPriceInPaise" integer NOT NULL DEFAULT '0', "includedBbbMinutes" integer NOT NULL DEFAULT '600', "maxStudents" integer NOT NULL DEFAULT '100', "customDomainEnabled" boolean NOT NULL DEFAULT false, "whitelabelEnabled" boolean NOT NULL DEFAULT false, "isActive" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "id" SERIAL NOT NULL, CONSTRAINT "UQ_a8b506b29b6676308f7c0fc6613" UNIQUE ("slug"), CONSTRAINT "PK_5fde988e5d9b9a522d70ebec27c" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "organization_subscription" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'trialing', "currentPeriodStart" TIMESTAMP, "currentPeriodEnd" TIMESTAMP, "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false, "cancelledAt" TIMESTAMP, "billingCustomerId" character varying, "version" integer NOT NULL DEFAULT '1', "id" SERIAL NOT NULL, "planId" integer NOT NULL, CONSTRAINT "PK_7a8b198dd9b0474bb1bdd391aa3" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "organization_subscription_channels_channel" ("organizationSubscriptionId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_347c6e7bfefa2c17fe8bbefa78b" PRIMARY KEY ("organizationSubscriptionId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_7c1949c0415b9bba53fb5f2812" ON "organization_subscription_channels_channel" ("organizationSubscriptionId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_acc66eb5bd8cb9a8921da820f7" ON "organization_subscription_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "organization_subscription" ADD CONSTRAINT "FK_157c49057080452d456c3ec6f50" FOREIGN KEY ("planId") REFERENCES "subscription_plan"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "organization_subscription_channels_channel" ADD CONSTRAINT "FK_7c1949c0415b9bba53fb5f28129" FOREIGN KEY ("organizationSubscriptionId") REFERENCES "organization_subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "organization_subscription_channels_channel" ADD CONSTRAINT "FK_acc66eb5bd8cb9a8921da820f78" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "organization_subscription_channels_channel" DROP CONSTRAINT "FK_acc66eb5bd8cb9a8921da820f78"`, undefined);
        await queryRunner.query(`ALTER TABLE "organization_subscription_channels_channel" DROP CONSTRAINT "FK_7c1949c0415b9bba53fb5f28129"`, undefined);
        await queryRunner.query(`ALTER TABLE "organization_subscription" DROP CONSTRAINT "FK_157c49057080452d456c3ec6f50"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_acc66eb5bd8cb9a8921da820f7"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_7c1949c0415b9bba53fb5f2812"`, undefined);
        await queryRunner.query(`DROP TABLE "organization_subscription_channels_channel"`, undefined);
        await queryRunner.query(`DROP TABLE "organization_subscription"`, undefined);
        await queryRunner.query(`DROP TABLE "subscription_plan"`, undefined);
   }

}
