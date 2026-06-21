import {MigrationInterface, QueryRunner} from "typeorm";

export class Cms1782018384400 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "article" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "slug" character varying NOT NULL, "title" character varying NOT NULL, "excerpt" character varying, "body" text NOT NULL, "isPublished" boolean NOT NULL DEFAULT false, "publishedAt" TIMESTAMP, "tags" text, "id" SERIAL NOT NULL, "featuredAssetId" integer, CONSTRAINT "PK_40808690eb7b915046558c0f81b" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "banner" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "title" character varying NOT NULL, "linkUrl" character varying, "placement" character varying NOT NULL, "priority" integer NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, "startsAt" TIMESTAMP, "endsAt" TIMESTAMP, "id" SERIAL NOT NULL, "imageId" integer NOT NULL, CONSTRAINT "PK_6d9e2570b3d85ba37b681cd4256" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "page" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "slug" character varying NOT NULL, "title" character varying NOT NULL, "metaDescription" character varying, "isPublished" boolean NOT NULL DEFAULT false, "sections" text NOT NULL DEFAULT '[]', "id" SERIAL NOT NULL, CONSTRAINT "PK_742f4117e065c5b6ad21b37ba1f" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "article_channels_channel" ("articleId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_7333457573dda86989b1871066c" PRIMARY KEY ("articleId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_80b0b058ef8a204ecc4af0a398" ON "article_channels_channel" ("articleId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_d4a68b2215c29a2da7a9710638" ON "article_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "banner_channels_channel" ("bannerId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_41e9a1318345e7b9c0af62fdd95" PRIMARY KEY ("bannerId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_c224a3dd6cdd68cf80b5de4778" ON "banner_channels_channel" ("bannerId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_45d1e8ec9049d0f162b47d7b65" ON "banner_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "page_channels_channel" ("pageId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_a7124120aadf07d16d10684b58c" PRIMARY KEY ("pageId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_9215ad10aca59ea9ef622d9824" ON "page_channels_channel" ("pageId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_e9444a8c7d98b8a3b35ca1ab43" ON "page_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "article" ADD CONSTRAINT "FK_15d705efa4adbf5bfcb54d9d7ee" FOREIGN KEY ("featuredAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "banner" ADD CONSTRAINT "FK_6a6cc2453a0675d3e2cad3070c0" FOREIGN KEY ("imageId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "article_channels_channel" ADD CONSTRAINT "FK_80b0b058ef8a204ecc4af0a398c" FOREIGN KEY ("articleId") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "article_channels_channel" ADD CONSTRAINT "FK_d4a68b2215c29a2da7a97106389" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "banner_channels_channel" ADD CONSTRAINT "FK_c224a3dd6cdd68cf80b5de47786" FOREIGN KEY ("bannerId") REFERENCES "banner"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "banner_channels_channel" ADD CONSTRAINT "FK_45d1e8ec9049d0f162b47d7b65a" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "page_channels_channel" ADD CONSTRAINT "FK_9215ad10aca59ea9ef622d9824b" FOREIGN KEY ("pageId") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "page_channels_channel" ADD CONSTRAINT "FK_e9444a8c7d98b8a3b35ca1ab430" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "page_channels_channel" DROP CONSTRAINT "FK_e9444a8c7d98b8a3b35ca1ab430"`, undefined);
        await queryRunner.query(`ALTER TABLE "page_channels_channel" DROP CONSTRAINT "FK_9215ad10aca59ea9ef622d9824b"`, undefined);
        await queryRunner.query(`ALTER TABLE "banner_channels_channel" DROP CONSTRAINT "FK_45d1e8ec9049d0f162b47d7b65a"`, undefined);
        await queryRunner.query(`ALTER TABLE "banner_channels_channel" DROP CONSTRAINT "FK_c224a3dd6cdd68cf80b5de47786"`, undefined);
        await queryRunner.query(`ALTER TABLE "article_channels_channel" DROP CONSTRAINT "FK_d4a68b2215c29a2da7a97106389"`, undefined);
        await queryRunner.query(`ALTER TABLE "article_channels_channel" DROP CONSTRAINT "FK_80b0b058ef8a204ecc4af0a398c"`, undefined);
        await queryRunner.query(`ALTER TABLE "banner" DROP CONSTRAINT "FK_6a6cc2453a0675d3e2cad3070c0"`, undefined);
        await queryRunner.query(`ALTER TABLE "article" DROP CONSTRAINT "FK_15d705efa4adbf5bfcb54d9d7ee"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e9444a8c7d98b8a3b35ca1ab43"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9215ad10aca59ea9ef622d9824"`, undefined);
        await queryRunner.query(`DROP TABLE "page_channels_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_45d1e8ec9049d0f162b47d7b65"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_c224a3dd6cdd68cf80b5de4778"`, undefined);
        await queryRunner.query(`DROP TABLE "banner_channels_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_d4a68b2215c29a2da7a9710638"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_80b0b058ef8a204ecc4af0a398"`, undefined);
        await queryRunner.query(`DROP TABLE "article_channels_channel"`, undefined);
        await queryRunner.query(`DROP TABLE "page"`, undefined);
        await queryRunner.query(`DROP TABLE "banner"`, undefined);
        await queryRunner.query(`DROP TABLE "article"`, undefined);
   }

}
