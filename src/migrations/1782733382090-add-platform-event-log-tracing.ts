import {MigrationInterface, QueryRunner} from "typeorm";

export class AddPlatformEventLogTracing1782733382090 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "event_log" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "eventType" character varying NOT NULL, "payload" text NOT NULL, "source" character varying NOT NULL, "correlationId" character varying NOT NULL, "parentEventId" character varying, "timestamp" TIMESTAMP NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "errorMessage" text, "triggeredBy" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_d8ccd9b5b44828ea378dd37e691" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_215c2853d3895d6591792ac4fa" ON "event_log" ("timestamp") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_9e09df6a90ccacbf7c3ec76d1e" ON "event_log" ("source", "status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_e315e519701d7751778651cf17" ON "event_log" ("parentEventId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b41b298cacdad93eed66bbdd23" ON "event_log" ("correlationId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_b41b298cacdad93eed66bbdd23"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e315e519701d7751778651cf17"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9e09df6a90ccacbf7c3ec76d1e"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_215c2853d3895d6591792ac4fa"`, undefined);
        await queryRunner.query(`DROP TABLE "event_log"`, undefined);
   }

}
