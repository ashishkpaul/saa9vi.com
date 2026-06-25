import {MigrationInterface, QueryRunner} from "typeorm";

export class Bugs1782369776476 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_0ab85f4be07b22d79906671d72"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_875a4ba4aebdc1855dbf176dad"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_server" ADD "encryptionKeyVersion" integer NOT NULL DEFAULT '1'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_meeting" ADD "encryptionKeyVersion" integer NOT NULL DEFAULT '1'`, undefined);
        await queryRunner.query(`ALTER TABLE "article" ADD "channelId" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "page" ADD "channelId" character varying`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_c43fc32d50ee689b016923d06a" ON "article" ("channelId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0ab85f4be07b22d79906671d72" ON "article" ("slug") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_5c3dc3acb508e64a4446afb65d" ON "page" ("channelId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_875a4ba4aebdc1855dbf176dad" ON "page" ("slug") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_875a4ba4aebdc1855dbf176dad"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_5c3dc3acb508e64a4446afb65d"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_0ab85f4be07b22d79906671d72"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_c43fc32d50ee689b016923d06a"`, undefined);
        await queryRunner.query(`ALTER TABLE "page" DROP COLUMN "channelId"`, undefined);
        await queryRunner.query(`ALTER TABLE "article" DROP COLUMN "channelId"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_meeting" DROP COLUMN "encryptionKeyVersion"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_server" DROP COLUMN "encryptionKeyVersion"`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_875a4ba4aebdc1855dbf176dad" ON "page" ("slug") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_0ab85f4be07b22d79906671d72" ON "article" ("slug") `, undefined);
   }

}
