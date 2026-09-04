import {MigrationInterface, QueryRunner} from "typeorm";

export class AddCommissionLedger1788495793929 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "commission_ledger" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "orderId" character varying NOT NULL, "orderSource" character varying NOT NULL DEFAULT 'direct', "marketplaceRef" character varying, "grossAmountInPaise" integer NOT NULL, "commissionPercent" integer NOT NULL, "commissionAmountInPaise" integer NOT NULL, "currency" character varying NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "PK_e67ec00c4e57158060e5e40c1fe" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_6750a70daf2e6a2e47e7b1f62f" ON "commission_ledger" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_0e2abf754c4e5be7c5f192a06f" ON "commission_ledger" ("orderId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_201c2804d4ca90bae496cddb9a" ON "commission_ledger" ("marketplaceRef", "orderId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_201c2804d4ca90bae496cddb9a"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_0e2abf754c4e5be7c5f192a06f"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_6750a70daf2e6a2e47e7b1f62f"`, undefined);
        await queryRunner.query(`DROP TABLE "commission_ledger"`, undefined);
   }

}
