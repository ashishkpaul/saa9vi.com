import {MigrationInterface, QueryRunner} from "typeorm";

export class AddSessionAttendance1788681926219 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "session_attendance" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "scheduledSessionId" character varying NOT NULL, "meetingId" character varying, "customerId" character varying NOT NULL, "joinedAt" TIMESTAMP, "leftAt" TIMESTAMP, "totalDurationSeconds" integer NOT NULL DEFAULT '0', "cyclesCount" integer NOT NULL DEFAULT '0', "attendanceStatus" character varying NOT NULL DEFAULT 'PRESENT', "source" character varying NOT NULL DEFAULT 'WEBHOOK', "lastEventAt" TIMESTAMP, "lastProcessedWebhookEventId" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_bc946a8e6bc80fd2531356f89e6" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_54f08cc8c75ad45e67d5f186a8" ON "session_attendance" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_3a0ac74be7e42a82da34184fb0" ON "session_attendance" ("customerId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_d7d2ce0502d1d29342548557bf" ON "session_attendance" ("channelId", "scheduledSessionId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ac2f89757a342acf8cf70f3b5a" ON "session_attendance" ("scheduledSessionId", "customerId", "channelId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_ac2f89757a342acf8cf70f3b5a"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_d7d2ce0502d1d29342548557bf"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_3a0ac74be7e42a82da34184fb0"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_54f08cc8c75ad45e67d5f186a8"`, undefined);
        await queryRunner.query(`DROP TABLE "session_attendance"`, undefined);
   }

}
