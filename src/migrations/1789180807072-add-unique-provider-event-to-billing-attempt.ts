import {MigrationInterface, QueryRunner} from "typeorm";

export class AddUniqueProviderEventToBillingAttempt1789180807072 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_b8f64963b5adfd82ca6d97911b"`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_95aca74860e2bdfdbc5f54dfc2" ON "subscription_billing_attempt" ("provider", "providerEventId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_95aca74860e2bdfdbc5f54dfc2"`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b8f64963b5adfd82ca6d97911b" ON "subscription_billing_attempt" ("providerEventId") `, undefined);
   }

}
