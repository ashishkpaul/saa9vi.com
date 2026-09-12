import {MigrationInterface, QueryRunner} from "typeorm";

export class AddFailedAtToProviderWebhookEvent1789180117889 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "provider_webhook_event" ADD "failedAt" TIMESTAMP`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "provider_webhook_event" DROP COLUMN "failedAt"`, undefined);
   }

}
