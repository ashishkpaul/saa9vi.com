import {MigrationInterface, QueryRunner} from "typeorm";

export class AddMaxConcurrentMeetingsToCapacityPolicy1790319702564 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_platform_capacity_policy" ADD "maxConcurrentMeetings" integer NOT NULL DEFAULT '5'`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_platform_capacity_policy" DROP COLUMN "maxConcurrentMeetings"`, undefined);
   }

}
