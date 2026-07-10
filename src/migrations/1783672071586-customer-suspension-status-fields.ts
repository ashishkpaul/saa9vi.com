import {MigrationInterface, QueryRunner} from "typeorm";

export class CustomerSuspensionStatusFields1783672071586 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "customer_channel_status" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "customerId" character varying NOT NULL, "channelId" character varying NOT NULL, "status" character varying NOT NULL, "reason" text, "id" SERIAL NOT NULL, CONSTRAINT "PK_2dadc26b8676d6bd72f965434d0" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a0c49e61444b083c1396bb8eef" ON "customer_channel_status" ("customerId", "channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "customer_status_change_log" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "customerId" character varying NOT NULL, "channelId" character varying, "scope" character varying NOT NULL, "previousStatus" character varying NOT NULL, "newStatus" character varying NOT NULL, "reason" text, "changedByAdministratorId" character varying, "changedAt" TIMESTAMP WITH TIME ZONE, "id" SERIAL NOT NULL, CONSTRAINT "PK_a5c8ae5dbc1e612becd564fb528" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_8531160a81fa63d31b9c59c4b4" ON "customer_status_change_log" ("scope") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_52b60fc3a3767cfdcf1031ef40" ON "customer_status_change_log" ("customerId") `, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD "customFieldsStatus" character varying(255)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN "customFieldsStatus"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_52b60fc3a3767cfdcf1031ef40"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_8531160a81fa63d31b9c59c4b4"`, undefined);
        await queryRunner.query(`DROP TABLE "customer_status_change_log"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_a0c49e61444b083c1396bb8eef"`, undefined);
        await queryRunner.query(`DROP TABLE "customer_channel_status"`, undefined);
   }

}
