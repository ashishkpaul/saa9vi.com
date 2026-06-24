import {MigrationInterface, QueryRunner} from "typeorm";

export class BbbCapacity1782278541045 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_capacity_grant" ADD "productVariantId" character varying`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_capacity_grant" DROP COLUMN "productVariantId"`, undefined);
   }

}
