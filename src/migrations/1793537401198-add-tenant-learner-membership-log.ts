import {MigrationInterface, QueryRunner} from "typeorm";

export class AddTenantLearnerMembershipLog1793537401198 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "tenant_learner_membership_log" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "membershipId" character varying NOT NULL, "customerId" character varying NOT NULL, "channelId" character varying NOT NULL, "oldStatus" character varying, "newStatus" character varying NOT NULL, "reason" character varying, "actorId" character varying, "transitionedAt" TIMESTAMP NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "PK_e925e56b4951761003e998161d7" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_425f069cbbb30b9e916b95b84b" ON "tenant_learner_membership_log" ("customerId", "channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_5537f5b6383c6c71de687472ca" ON "tenant_learner_membership_log" ("membershipId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_5537f5b6383c6c71de687472ca"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_425f069cbbb30b9e916b95b84b"`, undefined);
        await queryRunner.query(`DROP TABLE "tenant_learner_membership_log"`, undefined);
   }

}
