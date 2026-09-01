import {MigrationInterface, QueryRunner} from "typeorm";

export class SessionSubjectTags1788266256055 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" ADD "subjectTags" text`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" DROP COLUMN "subjectTags"`, undefined);
   }

}
