import {MigrationInterface, QueryRunner} from "typeorm";

export class BigCapacity1787898254184 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_28e527123d1c7df50b8fc489c7"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_platform_capacity_policy" ADD "channelId" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" DROP COLUMN "receivedAt"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" ADD "receivedAt" TIMESTAMP NOT NULL`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" DROP COLUMN "processedAt"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" ADD "processedAt" TIMESTAMP`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_platform_capacity_policy" ALTER COLUMN "defaultRoomCapacity" SET DEFAULT '25'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_platform_capacity_policy" ALTER COLUMN "maxRoomCapacity" SET DEFAULT '100'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_platform_capacity_policy" ALTER COLUMN "maxConcurrentParticipants" SET DEFAULT '250'`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_53f0e8fe5cea36fb742fc0c624" ON "bbb_platform_capacity_policy" ("subscriptionPlanId", "channelId") WHERE "subscriptionPlanId" IS NULL AND "channelId" IS NULL`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_447f780790734b801c3307443d" ON "bbb_platform_capacity_policy" ("subscriptionPlanId") WHERE "subscriptionPlanId" IS NOT NULL`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_75827ee5d2c6691e8e1bdd2a62" ON "bbb_platform_capacity_policy" ("channelId") WHERE "channelId" IS NOT NULL`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b6741adfd949003e33d62dba5f" ON "organization_subscription" ("channelId") WHERE "status" != 'cancelled'`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_b6741adfd949003e33d62dba5f"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_75827ee5d2c6691e8e1bdd2a62"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_447f780790734b801c3307443d"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_53f0e8fe5cea36fb742fc0c624"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_platform_capacity_policy" ALTER COLUMN "maxConcurrentParticipants" SET DEFAULT '1000'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_platform_capacity_policy" ALTER COLUMN "maxRoomCapacity" SET DEFAULT '500'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_platform_capacity_policy" ALTER COLUMN "defaultRoomCapacity" SET DEFAULT '100'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" DROP COLUMN "processedAt"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" ADD "processedAt" TIMESTAMP WITH TIME ZONE`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" DROP COLUMN "receivedAt"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" ADD "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_platform_capacity_policy" DROP COLUMN "channelId"`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_28e527123d1c7df50b8fc489c7" ON "bbb_platform_capacity_policy" ("subscriptionPlanId") `, undefined);
   }

}
