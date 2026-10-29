import {MigrationInterface, QueryRunner} from "typeorm";

export class AddBbbServerLoadFields1793265688264 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_server" ADD "liveMeetings" integer NOT NULL DEFAULT '0'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_server" ADD "liveParticipants" integer NOT NULL DEFAULT '0'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_server" ADD "loadUpdatedAt" TIMESTAMP WITH TIME ZONE`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_server" DROP COLUMN "loadUpdatedAt"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_server" DROP COLUMN "liveParticipants"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_server" DROP COLUMN "liveMeetings"`, undefined);
   }

}
