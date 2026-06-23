import {MigrationInterface, QueryRunner} from "typeorm";

export class ReviewFixes21782215885323 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "tenant_profile" DROP CONSTRAINT "FK_e278e9ac36b96100900fd02b721"`, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_organization_channels_channel" ("bbbOrganizationId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_b94a24836e6ca4f3c820008118a" PRIMARY KEY ("bbbOrganizationId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_dd4585c1d20fd740c7a156ea26" ON "bbb_organization_channels_channel" ("bbbOrganizationId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_af344614b25b6c21a363198abf" ON "bbb_organization_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "tenant_profile_channels_channel" ("tenantProfileId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_9f748b9ba49d632fec9d30eb77f" PRIMARY KEY ("tenantProfileId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_8331da858c9a3c2bbeb71ea4b0" ON "tenant_profile_channels_channel" ("tenantProfileId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_af70e6531c914a0f9a7ff0ae50" ON "tenant_profile_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" ADD "tenantProfileId" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" ADD "productVariantId" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" DROP CONSTRAINT "UQ_5bd18b6ae78b670b730a4a4ef9f"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" DROP CONSTRAINT "UQ_51f725b8d4df66237de868676ea"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e278e9ac36b96100900fd02b72"`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile" DROP COLUMN "channelId"`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile" ADD "channelId" character varying NOT NULL`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile" DROP CONSTRAINT "UQ_3eed8afc55cfbfbd2c8000b2382"`, undefined);
        await queryRunner.query(`ALTER TABLE "instructor_profile" DROP CONSTRAINT "UQ_9f4b67effb4ef6c2c29aa990d14"`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5bd18b6ae78b670b730a4a4ef9" ON "bbb_organization" ("channelId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_51f725b8d4df66237de868676e" ON "bbb_organization" ("slug") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_e278e9ac36b96100900fd02b72" ON "tenant_profile" ("channelId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8be79acf8493fbb54db3c515d6" ON "instructor_profile" ("channelId", "slug") `, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization_channels_channel" ADD CONSTRAINT "FK_dd4585c1d20fd740c7a156ea26a" FOREIGN KEY ("bbbOrganizationId") REFERENCES "bbb_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization_channels_channel" ADD CONSTRAINT "FK_af344614b25b6c21a363198abf2" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile_channels_channel" ADD CONSTRAINT "FK_8331da858c9a3c2bbeb71ea4b0e" FOREIGN KEY ("tenantProfileId") REFERENCES "tenant_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile_channels_channel" ADD CONSTRAINT "FK_af70e6531c914a0f9a7ff0ae50f" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "tenant_profile_channels_channel" DROP CONSTRAINT "FK_af70e6531c914a0f9a7ff0ae50f"`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile_channels_channel" DROP CONSTRAINT "FK_8331da858c9a3c2bbeb71ea4b0e"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization_channels_channel" DROP CONSTRAINT "FK_af344614b25b6c21a363198abf2"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization_channels_channel" DROP CONSTRAINT "FK_dd4585c1d20fd740c7a156ea26a"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_8be79acf8493fbb54db3c515d6"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e278e9ac36b96100900fd02b72"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_51f725b8d4df66237de868676e"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_5bd18b6ae78b670b730a4a4ef9"`, undefined);
        await queryRunner.query(`ALTER TABLE "instructor_profile" ADD CONSTRAINT "UQ_9f4b67effb4ef6c2c29aa990d14" UNIQUE ("slug")`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile" ADD CONSTRAINT "UQ_3eed8afc55cfbfbd2c8000b2382" UNIQUE ("businessName")`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile" DROP COLUMN "channelId"`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile" ADD "channelId" integer NOT NULL`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_e278e9ac36b96100900fd02b72" ON "tenant_profile" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" ADD CONSTRAINT "UQ_51f725b8d4df66237de868676ea" UNIQUE ("slug")`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" ADD CONSTRAINT "UQ_5bd18b6ae78b670b730a4a4ef9f" UNIQUE ("channelId")`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" DROP COLUMN "productVariantId"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization" DROP COLUMN "tenantProfileId"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_af70e6531c914a0f9a7ff0ae50"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_8331da858c9a3c2bbeb71ea4b0"`, undefined);
        await queryRunner.query(`DROP TABLE "tenant_profile_channels_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_af344614b25b6c21a363198abf"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_dd4585c1d20fd740c7a156ea26"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_organization_channels_channel"`, undefined);
        await queryRunner.query(`ALTER TABLE "tenant_profile" ADD CONSTRAINT "FK_e278e9ac36b96100900fd02b721" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
   }

}
