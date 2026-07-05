import {MigrationInterface, QueryRunner} from "typeorm";

export class TenantProfileCustomDomain1783228720863 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "tenant_profile" ADD "customDomain" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile" ADD CONSTRAINT "UQ_ef1b081c39c23746c9411b67e65" UNIQUE ("customDomain")`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "tenant_profile" DROP CONSTRAINT "UQ_ef1b081c39c23746c9411b67e65"`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile" DROP COLUMN "customDomain"`, undefined);
   }

}
