import {MigrationInterface, QueryRunner} from "typeorm";

export class EnsureTenantPaymentAccountSchema1794465004363 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "tenant_payment_account" ADD CONSTRAINT "IDX_tenant_payment_account_channel_provider" UNIQUE ("channelId", "provider")`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "tenant_payment_account" DROP CONSTRAINT "IDX_tenant_payment_account_channel_provider"`, undefined);
   }

}
