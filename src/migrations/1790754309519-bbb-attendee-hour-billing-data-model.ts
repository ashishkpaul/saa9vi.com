import {MigrationInterface, QueryRunner} from "typeorm";

export class BbbAttendeeHourBillingDataModel1790754309519 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bbb_meeting_sample" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "meetingId" character varying NOT NULL, "bucketMinute" TIMESTAMP NOT NULL, "learnerCount" integer NOT NULL DEFAULT '0', "moderatorCount" integer NOT NULL DEFAULT '0', "id" SERIAL NOT NULL, CONSTRAINT "PK_90d30bd2a268747eaab92f57072" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c7db10efdb356f1e69222b4f77" ON "bbb_meeting_sample" ("meetingId", "bucketMinute") `, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_metered_usage" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "meetingId" character varying NOT NULL, "organizationId" character varying NOT NULL, "channelId" character varying NOT NULL, "roomId" character varying, "startedAt" TIMESTAMP NOT NULL, "completedAt" TIMESTAMP NOT NULL, "learnerMinutes" integer NOT NULL DEFAULT '0', "peakLearners" integer NOT NULL DEFAULT '0', "peakModerators" integer NOT NULL DEFAULT '0', "ratePaisePerHour" integer NOT NULL DEFAULT '0', "periodMonth" character(7) NOT NULL, "billingCapped" boolean NOT NULL DEFAULT false, "id" SERIAL NOT NULL, CONSTRAINT "PK_f500eece52116fb7b79cb52171b" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e0d3296a780b35669883cbca47" ON "bbb_metered_usage" ("meetingId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_3a5096dbae2383f151305a1023" ON "bbb_metered_usage" ("channelId", "completedAt") `, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" ADD "billingMode" character varying NOT NULL DEFAULT 'grant'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" ADD "ratePaisePerLearnerHour" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" ADD "monthlySpendLimitPaise" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" ADD "roomId" character varying`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_68fe7986c9b97d63b05c3be8de" ON "bbb_scheduled_session" ("roomId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_68fe7986c9b97d63b05c3be8de"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" DROP COLUMN "roomId"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" DROP COLUMN "monthlySpendLimitPaise"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" DROP COLUMN "ratePaisePerLearnerHour"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" DROP COLUMN "billingMode"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_3a5096dbae2383f151305a1023"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e0d3296a780b35669883cbca47"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_metered_usage"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_c7db10efdb356f1e69222b4f77"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_meeting_sample"`, undefined);
   }

}
