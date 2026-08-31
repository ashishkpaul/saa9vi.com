import {MigrationInterface, QueryRunner} from "typeorm";

export class JuspayWebhookEndpointSecretHardening1788158855462 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "juspay_webhook_endpoint" ADD "encryptionKeyVersion" integer NOT NULL DEFAULT '1'`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "juspay_webhook_endpoint" DROP COLUMN "encryptionKeyVersion"`, undefined);
   }

}
