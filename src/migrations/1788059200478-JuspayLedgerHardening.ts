import {MigrationInterface, QueryRunner} from "typeorm";

export class JuspayLedgerHardening1788059200478 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "juspay_payment_attempt" ADD "channelId" character varying NOT NULL`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e2b2245131f526d370d3a680cf" ON "juspay_subscription_mandate" ("subscriptionId") WHERE "status" != 'revoked'`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_c4d104a2865448ab2caacbc078" ON "juspay_payment_attempt" ("channelId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_c4d104a2865448ab2caacbc078"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e2b2245131f526d370d3a680cf"`, undefined);
        await queryRunner.query(`ALTER TABLE "juspay_payment_attempt" DROP COLUMN "channelId"`, undefined);
   }

}
