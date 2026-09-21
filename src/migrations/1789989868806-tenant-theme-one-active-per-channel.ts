import {MigrationInterface, QueryRunner} from "typeorm";

export class TenantThemeOneActivePerChannel1789989868806 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d7bc43fa58b1192308f741227e" ON "tenant_theme" ("channelId") WHERE "status" = 'active'`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_d7bc43fa58b1192308f741227e"`, undefined);
   }

}
