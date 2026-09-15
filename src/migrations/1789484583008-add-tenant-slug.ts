import {MigrationInterface, QueryRunner} from "typeorm";

export class AddTenantSlug1789484583008 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "tenant_profile" ADD "tenantSlug" character varying`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4abe16fa95c99f301d83cf0b53" ON "tenant_profile" ("tenantSlug") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_4abe16fa95c99f301d83cf0b53"`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile" DROP COLUMN "tenantSlug"`, undefined);
   }

}
