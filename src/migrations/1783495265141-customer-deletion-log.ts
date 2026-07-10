import {MigrationInterface, QueryRunner} from "typeorm";

export class CustomerDeletionLog1783495265141 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "customer_deletion_log" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "customerId" character varying NOT NULL, "channelId" character varying, "deletionType" character varying NOT NULL, "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "processedAt" TIMESTAMP WITH TIME ZONE, "status" character varying NOT NULL DEFAULT 'PENDING', "errorMessage" text, "id" SERIAL NOT NULL, CONSTRAINT "PK_1135fe65c9e4926ac2b835aaf1d" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_4e5a29ec96c1c71ed5c1ae16e9" ON "customer_deletion_log" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_da831e2bdcc7ac6e3e5909725a" ON "customer_deletion_log" ("customerId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_da831e2bdcc7ac6e3e5909725a"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_4e5a29ec96c1c71ed5c1ae16e9"`, undefined);
        await queryRunner.query(`DROP TABLE "customer_deletion_log"`, undefined);
   }

}
