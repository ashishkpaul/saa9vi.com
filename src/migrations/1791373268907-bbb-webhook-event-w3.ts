import {MigrationInterface, QueryRunner} from "typeorm";

export class BbbWebhookEventW31791373268907 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" ADD "serverId" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" ADD "rawBody" text`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" ADD "dedupeKey" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" ALTER COLUMN "eventType" DROP NOT NULL`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" ALTER COLUMN "payload" DROP NOT NULL`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e58a0f41aeae9ce539f79119c3" ON "bbb_webhook_event" ("dedupeKey") WHERE "dedupeKey" IS NOT NULL`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_e58a0f41aeae9ce539f79119c3"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" ALTER COLUMN "payload" SET NOT NULL`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" ALTER COLUMN "eventType" SET NOT NULL`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" DROP COLUMN "dedupeKey"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" DROP COLUMN "rawBody"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_webhook_event" DROP COLUMN "serverId"`, undefined);
   }

}
