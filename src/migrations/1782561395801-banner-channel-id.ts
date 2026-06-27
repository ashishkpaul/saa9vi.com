import {MigrationInterface, QueryRunner} from "typeorm";

export class BannerChannelId1782561395801 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "banner" ADD "channelId" character varying`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b813ca434eab2bcce913a791b7" ON "banner" ("channelId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_b813ca434eab2bcce913a791b7"`, undefined);
        await queryRunner.query(`ALTER TABLE "banner" DROP COLUMN "channelId"`, undefined);
   }

}
