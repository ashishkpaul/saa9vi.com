import {MigrationInterface, QueryRunner} from "typeorm";

export class AddCommissionLedgerUniqueConstraints1788497028332 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_0e2abf754c4e5be7c5f192a06f"`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0e2abf754c4e5be7c5f192a06f" ON "commission_ledger" ("orderId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_80af445df49419dbf467a870ad" ON "commission_ledger" ("marketplaceRef") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_80af445df49419dbf467a870ad"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_0e2abf754c4e5be7c5f192a06f"`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_0e2abf754c4e5be7c5f192a06f" ON "commission_ledger" ("orderId") `, undefined);
   }

}
