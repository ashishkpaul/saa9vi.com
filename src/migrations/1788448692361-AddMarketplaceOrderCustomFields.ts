import {MigrationInterface, QueryRunner} from "typeorm";

export class AddMarketplaceOrderCustomFields1788448692361 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsOrdersource" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsMarketplaceref" character varying(255)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsMarketplaceref"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsOrdersource"`, undefined);
   }

}
