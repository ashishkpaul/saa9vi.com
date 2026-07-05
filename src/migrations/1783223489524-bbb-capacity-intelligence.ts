import {MigrationInterface, QueryRunner} from "typeorm";

export class BbbCapacityIntelligence1783223489524 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TYPE "public"."bbb_capacity_alert_log_urgency_enum" AS ENUM('none', 'plan', 'soon', 'immediate')`, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_capacity_alert_log" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "checkedAt" TIMESTAMP NOT NULL, "urgency" "public"."bbb_capacity_alert_log_urgency_enum" NOT NULL, "serversNeeded" integer NOT NULL, "peakForecastPercent" double precision NOT NULL, "peakForecastAt" TIMESTAMP, "reasoning" text, "id" SERIAL NOT NULL, CONSTRAINT "PK_1906df4da1e714830a17f288741" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_server" ADD "capacity" integer NOT NULL DEFAULT '200'`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_server" DROP COLUMN "capacity"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_capacity_alert_log"`, undefined);
        await queryRunner.query(`DROP TYPE "public"."bbb_capacity_alert_log_urgency_enum"`, undefined);
   }

}
