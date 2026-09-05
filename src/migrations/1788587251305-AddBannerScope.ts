import {MigrationInterface, QueryRunner} from "typeorm";

export class AddBannerScope1788587251305 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "banner" ADD "scope" character varying NOT NULL DEFAULT 'tenant'`, undefined);
        await queryRunner.query(`ALTER TABLE "banner" ADD "targetSubject" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "banner" ADD "targetCity" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "banner" ADD "campaignId" character varying`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b9a8605891464f4fe4b8764b8c" ON "banner" ("scope") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_905e4c230f2a0d4918e742230b" ON "banner" ("campaignId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_905e4c230f2a0d4918e742230b"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b9a8605891464f4fe4b8764b8c"`, undefined);
        await queryRunner.query(`ALTER TABLE "banner" DROP COLUMN "campaignId"`, undefined);
        await queryRunner.query(`ALTER TABLE "banner" DROP COLUMN "targetCity"`, undefined);
        await queryRunner.query(`ALTER TABLE "banner" DROP COLUMN "targetSubject"`, undefined);
        await queryRunner.query(`ALTER TABLE "banner" DROP COLUMN "scope"`, undefined);
   }

}
