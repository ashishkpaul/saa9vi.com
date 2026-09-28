import {MigrationInterface, QueryRunner} from "typeorm";

export class AddPaymentWebhookEvent1790583381147 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "payment_webhook_event" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "provider" character varying NOT NULL, "providerEventId" character varying NOT NULL, "eventType" character varying NOT NULL, "payloadHash" character varying NOT NULL, "rawPayload" json NOT NULL, "receivedAt" TIMESTAMP NOT NULL DEFAULT now(), "verifiedAt" TIMESTAMP, "processedAt" TIMESTAMP, "failedAt" TIMESTAMP, "processingStatus" character varying NOT NULL DEFAULT 'pending', "attemptCount" integer NOT NULL DEFAULT '0', "errorMessage" character varying, "vendureOrderCode" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_c3c3f2489911a78b8a75fe6673d" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_f2087256a45a2b82f3b75dc158" ON "payment_webhook_event" ("vendureOrderCode") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0766a0e6389097e1aed592cba0" ON "payment_webhook_event" ("provider", "providerEventId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_c6de1fa229b246cf2306fccf90" ON "payment_webhook_event" ("processingStatus") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_c6de1fa229b246cf2306fccf90"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_0766a0e6389097e1aed592cba0"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_f2087256a45a2b82f3b75dc158"`, undefined);
        await queryRunner.query(`DROP TABLE "payment_webhook_event"`, undefined);
   }

}
