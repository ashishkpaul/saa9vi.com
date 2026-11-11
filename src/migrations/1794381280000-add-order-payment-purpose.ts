import {MigrationInterface, QueryRunner} from "typeorm";

export class AddOrderPaymentPurpose1794381280000 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
       await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsPaymentpurpose" character varying(255)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
       await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsPaymentpurpose"`, undefined);
   }

}