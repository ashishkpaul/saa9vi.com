import {MigrationInterface, QueryRunner} from "typeorm";

export class BbbCapacity1782720122634 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_capacity_grant" ADD "sourceType" character varying NOT NULL DEFAULT 'order'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_capacity_grant" ADD "isUnbounded" boolean NOT NULL DEFAULT false`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_capacity_grant" DROP COLUMN "isUnbounded"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_capacity_grant" DROP COLUMN "sourceType"`, undefined);
   }

}
