import {MigrationInterface, QueryRunner} from "typeorm";

export class MakeBillingPeriodStartNullable1789885988242 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "subscription_billing_attempt" ALTER COLUMN "billingPeriodStart" DROP NOT NULL`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "subscription_billing_attempt" ALTER COLUMN "billingPeriodStart" SET NOT NULL`, undefined);
   }

}
