import {MigrationInterface, QueryRunner} from "typeorm";

export class AddTenantRegistrationLog1784203067205 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "tenant_registration_log" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "businessName" character varying NOT NULL, "emailAddress" character varying NOT NULL, "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "processedAt" TIMESTAMP WITH TIME ZONE, "status" character varying NOT NULL DEFAULT 'PENDING', "channelId" character varying, "channelToken" character varying, "errorMessage" text, "id" SERIAL NOT NULL, CONSTRAINT "PK_7db1cd2a95691eb485a355eab06" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_26e32f5564ee4d1cebfec9fd70" ON "tenant_registration_log" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_0d8656dc56b3a83fca693ed049" ON "tenant_registration_log" ("emailAddress") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_0d8656dc56b3a83fca693ed049"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_26e32f5564ee4d1cebfec9fd70"`, undefined);
        await queryRunner.query(`DROP TABLE "tenant_registration_log"`, undefined);
   }

}
