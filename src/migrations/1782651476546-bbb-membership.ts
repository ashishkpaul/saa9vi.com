import {MigrationInterface, QueryRunner} from "typeorm";

export class BbbMembership1782651476546 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_organization_membership" DROP COLUMN "role"`, undefined);
        await queryRunner.query(`CREATE TYPE "public"."bbb_organization_membership_role_enum" AS ENUM('org_admin', 'moderator', 'staff')`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization_membership" ADD "role" "public"."bbb_organization_membership_role_enum" NOT NULL`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_organization_membership" DROP COLUMN "role"`, undefined);
        await queryRunner.query(`DROP TYPE "public"."bbb_organization_membership_role_enum"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization_membership" ADD "role" character varying NOT NULL`, undefined);
   }

}
