import {MigrationInterface, QueryRunner} from "typeorm";

export class AddMarketplaceListingEnabledToPlan1790172415061 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "subscription_plan" ADD "marketplaceListingEnabled" boolean NOT NULL DEFAULT false`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "subscription_plan" DROP COLUMN "marketplaceListingEnabled"`, undefined);
   }

}
