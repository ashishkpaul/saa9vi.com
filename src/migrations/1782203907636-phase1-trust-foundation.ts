import {MigrationInterface, QueryRunner} from "typeorm";

export class Phase1TrustFoundation1782203907636 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bbb_trial_registration" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "scheduledSessionId" integer NOT NULL, "customerId" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'REGISTERED', "registeredAt" TIMESTAMP NOT NULL, "attendedAt" TIMESTAMP, "id" SERIAL NOT NULL, CONSTRAINT "PK_9f9c32a4e1f7983c7869fba9b61" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_ca36df442d78d5a14cf01af764" ON "bbb_trial_registration" ("scheduledSessionId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8d6098ccdc687b6a40422a3b31" ON "bbb_trial_registration" ("scheduledSessionId", "customerId") `, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_instructor_assignment" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "scheduledSessionId" integer NOT NULL, "instructorProfileId" character varying NOT NULL, "role" character varying NOT NULL DEFAULT 'primary', "displayOrder" integer NOT NULL DEFAULT '0', "id" SERIAL NOT NULL, CONSTRAINT "PK_e71efc4892328581e30bb348c4d" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_8f0f67ea0656bb9b20ff293169" ON "bbb_instructor_assignment" ("scheduledSessionId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_16c6de3fd6c9092c54ece7fdde" ON "bbb_instructor_assignment" ("instructorProfileId", "scheduledSessionId") `, undefined);
        await queryRunner.query(`CREATE TABLE "tenant_profile" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" integer NOT NULL, "businessName" character varying NOT NULL, "tagline" character varying, "timezone" character varying NOT NULL DEFAULT 'UTC', "contactEmail" character varying NOT NULL, "onboardingComplete" boolean NOT NULL DEFAULT false, "id" SERIAL NOT NULL, "logoAssetId" integer, CONSTRAINT "UQ_3eed8afc55cfbfbd2c8000b2382" UNIQUE ("businessName"), CONSTRAINT "PK_7fe9f75b9b5ab63db69e5738fff" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_e278e9ac36b96100900fd02b72" ON "tenant_profile" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "instructor_profile" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" integer NOT NULL, "customerId" integer NOT NULL, "createdById" character varying, "slug" character varying NOT NULL, "fullName" character varying NOT NULL, "bio" text, "credentials" character varying, "expertiseAreas" text NOT NULL DEFAULT '[]', "displayOrder" integer NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, "isPublic" boolean NOT NULL DEFAULT false, "id" SERIAL NOT NULL, "photoAssetId" integer, "created_by_id" integer, CONSTRAINT "UQ_9f4b67effb4ef6c2c29aa990d14" UNIQUE ("slug"), CONSTRAINT "PK_bd378acd9829a7f94b46e1dff16" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_7c30312092d56d0488e0d65270" ON "instructor_profile" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_56b4041e464fd749f664e2e0b6" ON "instructor_profile" ("customerId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_9f4b67effb4ef6c2c29aa990d1" ON "instructor_profile" ("slug") `, undefined);
        await queryRunner.query(`CREATE TABLE "media_resource" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" integer NOT NULL, "ownerType" character varying NOT NULL, "ownerId" character varying NOT NULL, "type" character varying NOT NULL, "url" character varying NOT NULL, "title" character varying NOT NULL, "displayOrder" integer NOT NULL DEFAULT '0', "isFeatured" boolean NOT NULL DEFAULT false, "isActive" boolean NOT NULL DEFAULT true, "id" SERIAL NOT NULL, "thumbnailAssetId" integer, CONSTRAINT "PK_aca5774dc6eca49ae48fe63e04e" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_dc55f017096ef82f82152d96ad" ON "media_resource" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" ADD "isTrial" boolean NOT NULL DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" ADD "visibility" character varying NOT NULL DEFAULT 'PRIVATE'`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" ADD "maxAttendees" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" ADD "slug" character varying`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c127e92eb51b74b4e35cd92f23" ON "bbb_scheduled_session" ("slug") `, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_trial_registration" ADD CONSTRAINT "FK_ca36df442d78d5a14cf01af7649" FOREIGN KEY ("scheduledSessionId") REFERENCES "bbb_scheduled_session"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_instructor_assignment" ADD CONSTRAINT "FK_8f0f67ea0656bb9b20ff293169e" FOREIGN KEY ("scheduledSessionId") REFERENCES "bbb_scheduled_session"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile" ADD CONSTRAINT "FK_e278e9ac36b96100900fd02b721" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "instructor_profile" ADD CONSTRAINT "FK_7c30312092d56d0488e0d652707" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "instructor_profile" ADD CONSTRAINT "FK_56b4041e464fd749f664e2e0b62" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "instructor_profile" ADD CONSTRAINT "FK_4383ee05f7b13ac2f92915922b4" FOREIGN KEY ("created_by_id") REFERENCES "customer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "media_resource" ADD CONSTRAINT "FK_dc55f017096ef82f82152d96ad9" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "media_resource" DROP CONSTRAINT "FK_dc55f017096ef82f82152d96ad9"`, undefined);
        await queryRunner.query(`ALTER TABLE "instructor_profile" DROP CONSTRAINT "FK_4383ee05f7b13ac2f92915922b4"`, undefined);
        await queryRunner.query(`ALTER TABLE "instructor_profile" DROP CONSTRAINT "FK_56b4041e464fd749f664e2e0b62"`, undefined);
        await queryRunner.query(`ALTER TABLE "instructor_profile" DROP CONSTRAINT "FK_7c30312092d56d0488e0d652707"`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile" DROP CONSTRAINT "FK_e278e9ac36b96100900fd02b721"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_instructor_assignment" DROP CONSTRAINT "FK_8f0f67ea0656bb9b20ff293169e"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_trial_registration" DROP CONSTRAINT "FK_ca36df442d78d5a14cf01af7649"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_c127e92eb51b74b4e35cd92f23"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" DROP COLUMN "slug"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" DROP COLUMN "maxAttendees"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" DROP COLUMN "visibility"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" DROP COLUMN "isTrial"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_dc55f017096ef82f82152d96ad"`, undefined);
        await queryRunner.query(`DROP TABLE "media_resource"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9f4b67effb4ef6c2c29aa990d1"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_56b4041e464fd749f664e2e0b6"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_7c30312092d56d0488e0d65270"`, undefined);
        await queryRunner.query(`DROP TABLE "instructor_profile"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e278e9ac36b96100900fd02b72"`, undefined);
        await queryRunner.query(`DROP TABLE "tenant_profile"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_16c6de3fd6c9092c54ece7fdde"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_8f0f67ea0656bb9b20ff293169"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_instructor_assignment"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_8d6098ccdc687b6a40422a3b31"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_ca36df442d78d5a14cf01af764"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_trial_registration"`, undefined);
   }

}
