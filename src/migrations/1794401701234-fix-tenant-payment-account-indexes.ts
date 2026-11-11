import {MigrationInterface, QueryRunner} from "typeorm";

export class FixTenantPaymentAccountIndexes1794401701234 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_tenant_payment_account_channelId"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_tenant_payment_account_channel_provider"`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_c51ee063fb3579a8510ddcc511" ON "tenant_payment_account" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_527fcf89a04a4c10b885133d62" ON "tenant_payment_account" ("provider") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_527fcf89a04a4c10b885133d62"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_c51ee063fb3579a8510ddcc511"`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_tenant_payment_account_channel_provider" ON "tenant_payment_account" ("channelId", "provider") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_tenant_payment_account_channelId" ON "tenant_payment_account" ("channelId") `, undefined);
   }

}
