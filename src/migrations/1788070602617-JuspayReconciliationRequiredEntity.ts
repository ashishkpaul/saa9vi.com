import {MigrationInterface, QueryRunner} from "typeorm";

export class JuspayReconciliationRequiredEntity1788070602617 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "juspay_payment_reconciliation_required" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "juspayOrderId" character varying NOT NULL, "invoiceId" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'PENDING', "resolutionNote" character varying, "detectedAt" TIMESTAMP NOT NULL, "id" SERIAL NOT NULL, "subscriptionId" integer NOT NULL, CONSTRAINT "PK_8f49b6e1364d0d7116eb9b428ff" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_9bf0a660b10954f7e971c62d94" ON "juspay_payment_reconciliation_required" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_0844a0aeb0ab229ba3eedecc4e" ON "juspay_payment_reconciliation_required" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_payment_reconciliation_required" ADD CONSTRAINT "FK_91340451ef3bf4e2a577785ef58" FOREIGN KEY ("subscriptionId") REFERENCES "organization_subscription"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "juspay_payment_reconciliation_required" DROP CONSTRAINT "FK_91340451ef3bf4e2a577785ef58"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_0844a0aeb0ab229ba3eedecc4e"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9bf0a660b10954f7e971c62d94"`, undefined);
        await queryRunner.query(`DROP TABLE "juspay_payment_reconciliation_required"`, undefined);
   }

}
