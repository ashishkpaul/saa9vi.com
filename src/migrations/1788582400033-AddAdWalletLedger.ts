import {MigrationInterface, QueryRunner} from "typeorm";

export class AddAdWalletLedger1788582400033 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "ad_wallet_ledger" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "walletId" character varying NOT NULL, "type" character varying NOT NULL, "amountInPaise" integer NOT NULL, "occurredAt" TIMESTAMP NOT NULL, "campaignId" character varying, "orderId" character varying, "reference" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_ba1723d7bb364886d6949e46f30" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_03bad7ab52064f0b6523df1462" ON "ad_wallet_ledger" ("walletId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_a1e2b729166a53ec25210912af" ON "ad_wallet_ledger" ("campaignId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f8b13f11757a24bcb0159f89d0" ON "ad_wallet_ledger" ("reference") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_f8b13f11757a24bcb0159f89d0"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_a1e2b729166a53ec25210912af"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_03bad7ab52064f0b6523df1462"`, undefined);
        await queryRunner.query(`DROP TABLE "ad_wallet_ledger"`, undefined);
   }

}
