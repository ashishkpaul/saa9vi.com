import {MigrationInterface, QueryRunner} from "typeorm";

export class MakeChannelIdNullable1789138449938 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "provider_webhook_event" ALTER COLUMN "channelId" DROP NOT NULL`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "provider_webhook_event" ALTER COLUMN "channelId" SET NOT NULL`, undefined);
   }

}
