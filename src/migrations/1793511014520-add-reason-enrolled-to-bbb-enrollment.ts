import {MigrationInterface, QueryRunner} from "typeorm";

export class AddReasonEnrolledToBbbEnrollment1793511014520 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_enrollment" ADD "reason" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_enrollment" ADD "enrolledByUserId" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_enrollment" ADD "enrolledAt" TIMESTAMP`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_enrollment" DROP COLUMN "enrolledAt"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_enrollment" DROP COLUMN "enrolledByUserId"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_enrollment" DROP COLUMN "reason"`, undefined);
   }

}
