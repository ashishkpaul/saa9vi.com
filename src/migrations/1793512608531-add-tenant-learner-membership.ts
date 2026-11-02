import {MigrationInterface, QueryRunner} from "typeorm";

export class AddTenantLearnerMembership1793512608531 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "tenant_learner_membership" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "customerId" character varying NOT NULL, "channelId" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'PENDING', "admissionType" character varying NOT NULL DEFAULT 'REGULAR', "lastActivityAt" TIMESTAMP, "invitedByUserId" character varying, "invitedAt" TIMESTAMP, "joinedAt" TIMESTAMP, "id" SERIAL NOT NULL, CONSTRAINT "PK_53d297c5818c43948c40f6c6255" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_968d9bc7e5744a43ebcbf96b3c" ON "tenant_learner_membership" ("customerId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b182ce952a2ee39a92c691fefb" ON "tenant_learner_membership" ("channelId", "status") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_00d1c564e2872db10d6d8d2414" ON "tenant_learner_membership" ("customerId", "channelId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_00d1c564e2872db10d6d8d2414"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b182ce952a2ee39a92c691fefb"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_968d9bc7e5744a43ebcbf96b3c"`, undefined);
        await queryRunner.query(`DROP TABLE "tenant_learner_membership"`, undefined);
   }

}
