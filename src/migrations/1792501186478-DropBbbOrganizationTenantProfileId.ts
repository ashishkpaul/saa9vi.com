import {MigrationInterface, QueryRunner} from "typeorm";

export class DropBbbOrganizationTenantProfileId1792501186478 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_organization" DROP COLUMN "tenantProfileId"`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_organization" ADD "tenantProfileId" character varying`, undefined);
   }

}
