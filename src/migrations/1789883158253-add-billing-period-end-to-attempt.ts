import {MigrationInterface, QueryRunner} from "typeorm";

export class AddBillingPeriodEndToAttempt1789883158253 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "subscription_billing_attempt" ADD "billingPeriodEnd" character varying(10)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "subscription_billing_attempt" DROP COLUMN "billingPeriodEnd"`, undefined);
   }

}
