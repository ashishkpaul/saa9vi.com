import {MigrationInterface, QueryRunner} from "typeorm";

export class AddBbbPlatformCapacityPolicy1787551102084 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bbb_platform_capacity_policy" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "defaultRoomCapacity" integer NOT NULL DEFAULT '100', "maxRoomCapacity" integer NOT NULL DEFAULT '500', "maxConcurrentParticipants" integer NOT NULL DEFAULT '1000', "subscriptionPlanId" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_12471b9337c47e7313834fa064c" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_28e527123d1c7df50b8fc489c7" ON "bbb_platform_capacity_policy" ("subscriptionPlanId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_28e527123d1c7df50b8fc489c7"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_platform_capacity_policy"`, undefined);
   }

}
