import {MigrationInterface, QueryRunner} from "typeorm";

export class AddMarketplaceGraceUntilToSubscription1790172546153 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "organization_subscription" ADD "marketplaceGraceUntil" TIMESTAMP`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "organization_subscription" DROP COLUMN "marketplaceGraceUntil"`, undefined);
   }

}
