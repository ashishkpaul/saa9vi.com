import {MigrationInterface, QueryRunner} from "typeorm";

export class ProviderQualifiedPaymentUniqueIndex1789821499654 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."UQ_billing_attempt_provider_payment"`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_billing_attempt_provider_payment" ON "subscription_billing_attempt" ("provider", "providerPaymentId") WHERE "providerPaymentId" IS NOT NULL`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."UQ_billing_attempt_provider_payment"`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_billing_attempt_provider_payment" ON "subscription_billing_attempt" ("providerPaymentId") WHERE ("providerPaymentId" IS NOT NULL)`, undefined);
   }

}
