import {MigrationInterface, QueryRunner} from "typeorm";

export class AddAttemptCountToProviderWebhookEvent1789141516883 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "provider_webhook_event" ADD "attemptCount" integer NOT NULL DEFAULT '0'`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "provider_webhook_event" DROP COLUMN "attemptCount"`, undefined);
   }

}
