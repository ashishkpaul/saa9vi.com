import {MigrationInterface, QueryRunner} from "typeorm";

export class BbbAuditTrail1791209870396 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_meeting" ADD "startedByUserId" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_meeting" ADD "endedByUserId" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_enrollment" ADD "deactivatedByUserId" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_enrollment" ADD "deactivatedAt" TIMESTAMP`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_entitlement" ADD "deactivatedByUserId" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_entitlement" ADD "deactivatedAt" TIMESTAMP`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_entitlement" DROP COLUMN "deactivatedAt"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_entitlement" DROP COLUMN "deactivatedByUserId"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_enrollment" DROP COLUMN "deactivatedAt"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_enrollment" DROP COLUMN "deactivatedByUserId"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_meeting" DROP COLUMN "endedByUserId"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_meeting" DROP COLUMN "startedByUserId"`, undefined);
   }

}
