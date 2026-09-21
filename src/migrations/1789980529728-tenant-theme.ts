import {MigrationInterface, QueryRunner} from "typeorm";

export class TenantTheme1789980529728 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "tenant_theme" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "version" integer NOT NULL DEFAULT '1', "status" character varying NOT NULL DEFAULT 'draft', "primaryColor" character varying(9), "secondaryColor" character varying(9), "accentColor" character varying(9), "backgroundColor" character varying(9), "textColor" character varying(9), "fontFamily" character varying, "logoAssetId" character varying, "displayName" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_b488a6c4f68d1c4f42bdb8d90c9" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_da44dc79dcc80f905f1a1a8da4" ON "tenant_theme" ("channelId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ab6be550238a40574acdf56222" ON "tenant_theme" ("channelId", "version") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_ab6be550238a40574acdf56222"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_da44dc79dcc80f905f1a1a8da4"`, undefined);
        await queryRunner.query(`DROP TABLE "tenant_theme"`, undefined);
   }

}
