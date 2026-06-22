import {MigrationInterface, QueryRunner} from "typeorm";

export class BbbVendureStandard1782126104437 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_organization_member" DROP CONSTRAINT "UQ_7a687c9b166629d6ce364990215"`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_organization_member" ADD CONSTRAINT "UQ_7a687c9b166629d6ce364990215" UNIQUE ("keycloakSub")`, undefined);
   }

}
