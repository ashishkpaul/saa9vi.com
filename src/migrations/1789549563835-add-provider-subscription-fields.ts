import {MigrationInterface, QueryRunner} from "typeorm";

export class AddProviderSubscriptionFields1789549563835 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "subscription_plan" ADD "providerPlanId" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "organization_subscription" ADD "providerStatus" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "organization_subscription" ADD "providerShortUrl" character varying`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "organization_subscription" DROP COLUMN "providerShortUrl"`, undefined);
        await queryRunner.query(`ALTER TABLE "organization_subscription" DROP COLUMN "providerStatus"`, undefined);
        await queryRunner.query(`ALTER TABLE "subscription_plan" DROP COLUMN "providerPlanId"`, undefined);
   }

}
