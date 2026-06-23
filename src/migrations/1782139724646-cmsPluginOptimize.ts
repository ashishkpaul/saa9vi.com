import {MigrationInterface, QueryRunner} from "typeorm";

export class CmsPluginOptimize1782139724646 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "banner" DROP CONSTRAINT "FK_6a6cc2453a0675d3e2cad3070c0"`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_0ab85f4be07b22d79906671d72" ON "article" ("slug") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_2d4cbd86a1b71609a9de58d98c" ON "article" ("isPublished") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_e33e1b06f063d1f3361831083b" ON "banner" ("placement") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_10e84f71d01bc582941849169e" ON "banner" ("isActive") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_875a4ba4aebdc1855dbf176dad" ON "page" ("slug") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_23292c5cb0288f3884a6794e14" ON "page" ("isPublished") `, undefined);
        await queryRunner.query(`ALTER TABLE "banner" ADD CONSTRAINT "FK_6a6cc2453a0675d3e2cad3070c0" FOREIGN KEY ("imageId") REFERENCES "asset"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "banner" DROP CONSTRAINT "FK_6a6cc2453a0675d3e2cad3070c0"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_23292c5cb0288f3884a6794e14"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_875a4ba4aebdc1855dbf176dad"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_10e84f71d01bc582941849169e"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e33e1b06f063d1f3361831083b"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_2d4cbd86a1b71609a9de58d98c"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_0ab85f4be07b22d79906671d72"`, undefined);
        await queryRunner.query(`ALTER TABLE "banner" ADD CONSTRAINT "FK_6a6cc2453a0675d3e2cad3070c0" FOREIGN KEY ("imageId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
   }

}
