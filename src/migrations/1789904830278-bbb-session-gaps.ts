import {MigrationInterface, QueryRunner} from "typeorm";

export class BbbSessionGaps1789904830278 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bbb_session_template" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "defaultTitle" character varying NOT NULL, "defaultTrainerId" character varying, "defaultSubjectTags" text, "defaultVisibility" character varying NOT NULL DEFAULT 'PRIVATE', "durationMinutes" integer NOT NULL DEFAULT '60', "productVariantId" character varying, "organizationId" integer NOT NULL, "channelId" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_25b8e426563318b4b36e53cd365" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_9288ad0a28e91d0ada887a66a9" ON "bbb_session_template" ("organizationId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_bf13c93d03f8cd8ab7afe6ae41" ON "bbb_session_template" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" ADD "maxSessionsPerOrg" integer NOT NULL DEFAULT '0'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" ALTER COLUMN "status" SET DEFAULT 'DRAFT'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_session_template" ADD CONSTRAINT "FK_9288ad0a28e91d0ada887a66a98" FOREIGN KEY ("organizationId") REFERENCES "bbb_organization"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_session_template" DROP CONSTRAINT "FK_9288ad0a28e91d0ada887a66a98"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" DROP COLUMN "maxSessionsPerOrg"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_bf13c93d03f8cd8ab7afe6ae41"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9288ad0a28e91d0ada887a66a9"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_session_template"`, undefined);
   }

}
