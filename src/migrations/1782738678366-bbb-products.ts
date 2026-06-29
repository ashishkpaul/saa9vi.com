import {MigrationInterface, QueryRunner} from "typeorm";

export class BbbProducts1782738678366 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsBbbsessionid" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsInstructorprofileid" character varying(255)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsInstructorprofileid"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsBbbsessionid"`, undefined);
   }

}
