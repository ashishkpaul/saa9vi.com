import {MigrationInterface, QueryRunner} from "typeorm";

export class AddBillingAttemptFields1788955214428 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "provider_webhook_event" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "provider" character varying NOT NULL, "providerEventId" character varying NOT NULL, "eventType" character varying NOT NULL, "payloadHash" character varying NOT NULL, "rawPayload" json NOT NULL, "receivedAt" TIMESTAMP NOT NULL DEFAULT now(), "verifiedAt" TIMESTAMP, "processedAt" TIMESTAMP, "processingStatus" character varying NOT NULL DEFAULT 'pending', "errorMessage" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_45b1f1155afa5e804fb65d6c3aa" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_ffa7a1ea1c840491bbaace28ce" ON "provider_webhook_event" ("processingStatus") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_759a6376a901f027d4a130bc5e" ON "provider_webhook_event" ("provider", "providerEventId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_6e1b826a441537e192f4173da1" ON "provider_webhook_event" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "subscription_billing_attempt" ADD "invoiceId" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "subscription_billing_attempt" ADD "providerAttemptId" character varying`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "subscription_billing_attempt" DROP COLUMN "providerAttemptId"`, undefined);
        await queryRunner.query(`ALTER TABLE "subscription_billing_attempt" DROP COLUMN "invoiceId"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_6e1b826a441537e192f4173da1"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_759a6376a901f027d4a130bc5e"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_ffa7a1ea1c840491bbaace28ce"`, undefined);
        await queryRunner.query(`DROP TABLE "provider_webhook_event"`, undefined);
   }

}
