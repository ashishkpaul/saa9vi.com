import {MigrationInterface, QueryRunner} from "typeorm";

export class Bbb1781955717365 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bbb_server" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "apiUrl" character varying NOT NULL, "encryptedApiSecret" character varying NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "currentLoad" integer NOT NULL DEFAULT '0', "maxLoad" integer NOT NULL DEFAULT '100', "healthy" boolean NOT NULL DEFAULT true, "lastHealthCheckAt" TIMESTAMP, "id" SERIAL NOT NULL, CONSTRAINT "UQ_fc256782b0e3b51b9ad9c42ede4" UNIQUE ("name"), CONSTRAINT "PK_e9efa7a5ab16f440529f42c4c0e" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_meeting" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "title" character varying NOT NULL, "bbbMeetingId" character varying, "bbbInternalMeetingId" character varying, "encryptedAttendeePassword" character varying, "encryptedModeratorPassword" character varying, "serverId" integer, "grantId" character varying, "attendeeJoinUrl" character varying, "attendeeJoinUrlExpiresAt" TIMESTAMP, "state" character varying NOT NULL DEFAULT 'Pending', "failureReason" character varying, "retryCount" integer NOT NULL DEFAULT '0', "provisionedAt" TIMESTAMP, "completedAt" TIMESTAMP, "recordingEnabled" boolean NOT NULL DEFAULT false, "bbbRecordingId" character varying, "recordingUrl" character varying, "roomId" character varying, "billingCapped" boolean NOT NULL DEFAULT false, "billingCapReason" character varying, "lastReconciledAt" TIMESTAMP, "reconciliationAttemptCount" integer NOT NULL DEFAULT '0', "pluginManifestsJson" text, "id" SERIAL NOT NULL, "organizationId" integer NOT NULL, CONSTRAINT "PK_33f2c503196edee1b2e5899083f" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_capacity_grant" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "orderId" character varying, "orderLineId" character varying, "grantedMinutes" integer NOT NULL DEFAULT '600', "consumedMinutes" integer NOT NULL DEFAULT '0', "validFrom" TIMESTAMP NOT NULL, "validUntil" TIMESTAMP NOT NULL, "exhausted" boolean NOT NULL DEFAULT false, "id" SERIAL NOT NULL, "organizationId" integer NOT NULL, CONSTRAINT "PK_7a7b4889dde69105ef6055fdec5" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_organization_member" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "customerId" character varying NOT NULL, "role" character varying NOT NULL, "active" boolean NOT NULL DEFAULT true, "keycloakSub" character varying, "id" SERIAL NOT NULL, "organizationId" integer NOT NULL, CONSTRAINT "UQ_7a687c9b166629d6ce364990215" UNIQUE ("keycloakSub"), CONSTRAINT "PK_a602abd49704a8f1f8df598a6d0" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_91ef6cdde918c635a447658f35" ON "bbb_organization_member" ("organizationId", "customerId") `, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_room" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "description" character varying, "slug" character varying, "createdByCustomerId" character varying, "recordingEnabled" boolean NOT NULL DEFAULT false, "maxParticipants" integer, "state" character varying NOT NULL DEFAULT 'Idle', "currentMeetingId" character varying, "retryCount" integer NOT NULL DEFAULT '0', "lastProvisionRequestedAt" TIMESTAMP, "lastRuntimeValidatedAt" TIMESTAMP, "version" integer NOT NULL, "id" SERIAL NOT NULL, "organizationId" integer NOT NULL, CONSTRAINT "UQ_0c1c354b3ddeee723edc6289249" UNIQUE ("slug"), CONSTRAINT "PK_a4a10e2e7560038a1470bfef788" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_organization" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "ownerUserId" character varying, "slug" character varying NOT NULL, "name" character varying NOT NULL, "concurrentMeetingLimit" integer NOT NULL DEFAULT '5', "maxParticipantsPerMeeting" integer NOT NULL DEFAULT '30', "recordingEnabled" boolean NOT NULL DEFAULT false, "suspended" boolean NOT NULL DEFAULT false, "id" SERIAL NOT NULL, CONSTRAINT "UQ_5bd18b6ae78b670b730a4a4ef9f" UNIQUE ("channelId"), CONSTRAINT "UQ_51f725b8d4df66237de868676ea" UNIQUE ("slug"), CONSTRAINT "PK_af1d6e9c2c57efe9028310bcf2b" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_usage_ledger" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "consumedMinutes" integer NOT NULL DEFAULT '0', "startedAt" TIMESTAMP NOT NULL, "completedAt" TIMESTAMP, "id" SERIAL NOT NULL, "meetingId" integer NOT NULL, "grantId" integer NOT NULL, CONSTRAINT "PK_e5ad686221af6583ea7f7b2dab9" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_535884030dae6cc2c2de0d4dee" ON "bbb_usage_ledger" ("meetingId", "grantId") `, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_scheduled_session" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "title" character varying NOT NULL, "startTime" TIMESTAMP NOT NULL, "endTime" TIMESTAMP NOT NULL, "status" character varying NOT NULL DEFAULT 'SCHEDULED', "id" SERIAL NOT NULL, "organizationId" integer, "trainerId" integer, "activeMeetingId" integer, CONSTRAINT "REL_a2ef10fddf24ba65d1c3fd2ae1" UNIQUE ("activeMeetingId"), CONSTRAINT "PK_3cde5390f275b736db319522162" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_90bd369103099bb5e933cffc44" ON "bbb_scheduled_session" ("organizationId") `, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_enrollment" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "roomId" integer NOT NULL, "customerId" character varying NOT NULL, "orderId" character varying, "active" boolean NOT NULL DEFAULT true, "validFrom" TIMESTAMP, "validUntil" TIMESTAMP, "expiresAt" TIMESTAMP, "source" character varying NOT NULL DEFAULT 'purchase', "id" SERIAL NOT NULL, CONSTRAINT "PK_568731101f7526c5939dfb615e6" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_ebd7608ba4cba4af722343e1d1" ON "bbb_enrollment" ("customerId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d41ac3ff63def9349e29e5a789" ON "bbb_enrollment" ("roomId", "customerId") `, undefined);
        await queryRunner.query(`CREATE TABLE "bbb_product_access" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "productVariantId" character varying NOT NULL, "accessDays" integer, "id" SERIAL NOT NULL, "roomId" integer NOT NULL, CONSTRAINT "PK_eb76abd541b077a46bb2c0afc8a" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c72c3f87408f1509f53c0e26ee" ON "bbb_product_access" ("productVariantId") `, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_meeting" ADD CONSTRAINT "FK_4a530ff448d0a75a517b500c65c" FOREIGN KEY ("organizationId") REFERENCES "bbb_organization"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_meeting" ADD CONSTRAINT "FK_e28d7310e9f3316822340524487" FOREIGN KEY ("serverId") REFERENCES "bbb_server"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_capacity_grant" ADD CONSTRAINT "FK_1c7b996ce12e64a7083b8a5f186" FOREIGN KEY ("organizationId") REFERENCES "bbb_organization"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization_member" ADD CONSTRAINT "FK_1b9c5e1c8c7da3e3559fce73cc1" FOREIGN KEY ("organizationId") REFERENCES "bbb_organization"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_room" ADD CONSTRAINT "FK_0858dd0a8b6e60fecb474736999" FOREIGN KEY ("organizationId") REFERENCES "bbb_organization"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_usage_ledger" ADD CONSTRAINT "FK_aa701fa66ba079122f6d993cd4d" FOREIGN KEY ("meetingId") REFERENCES "bbb_meeting"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_usage_ledger" ADD CONSTRAINT "FK_1ce01cfd1085f631e5a0737293f" FOREIGN KEY ("grantId") REFERENCES "bbb_capacity_grant"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" ADD CONSTRAINT "FK_90bd369103099bb5e933cffc445" FOREIGN KEY ("organizationId") REFERENCES "bbb_organization"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" ADD CONSTRAINT "FK_df240acabd8f98deea3cd388e16" FOREIGN KEY ("trainerId") REFERENCES "bbb_organization_member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" ADD CONSTRAINT "FK_a2ef10fddf24ba65d1c3fd2ae1b" FOREIGN KEY ("activeMeetingId") REFERENCES "bbb_meeting"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_enrollment" ADD CONSTRAINT "FK_c066a573a148fee2c476b883ade" FOREIGN KEY ("roomId") REFERENCES "bbb_room"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_product_access" ADD CONSTRAINT "FK_36ee9d2485608a1195d258adb6f" FOREIGN KEY ("roomId") REFERENCES "bbb_room"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bbb_product_access" DROP CONSTRAINT "FK_36ee9d2485608a1195d258adb6f"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_enrollment" DROP CONSTRAINT "FK_c066a573a148fee2c476b883ade"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" DROP CONSTRAINT "FK_a2ef10fddf24ba65d1c3fd2ae1b"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" DROP CONSTRAINT "FK_df240acabd8f98deea3cd388e16"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_scheduled_session" DROP CONSTRAINT "FK_90bd369103099bb5e933cffc445"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_usage_ledger" DROP CONSTRAINT "FK_1ce01cfd1085f631e5a0737293f"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_usage_ledger" DROP CONSTRAINT "FK_aa701fa66ba079122f6d993cd4d"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_room" DROP CONSTRAINT "FK_0858dd0a8b6e60fecb474736999"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_organization_member" DROP CONSTRAINT "FK_1b9c5e1c8c7da3e3559fce73cc1"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_capacity_grant" DROP CONSTRAINT "FK_1c7b996ce12e64a7083b8a5f186"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_meeting" DROP CONSTRAINT "FK_e28d7310e9f3316822340524487"`, undefined);
        await queryRunner.query(`ALTER TABLE "bbb_meeting" DROP CONSTRAINT "FK_4a530ff448d0a75a517b500c65c"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_c72c3f87408f1509f53c0e26ee"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_product_access"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_d41ac3ff63def9349e29e5a789"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_ebd7608ba4cba4af722343e1d1"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_enrollment"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_90bd369103099bb5e933cffc44"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_scheduled_session"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_535884030dae6cc2c2de0d4dee"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_usage_ledger"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_organization"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_room"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_91ef6cdde918c635a447658f35"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_organization_member"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_capacity_grant"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_meeting"`, undefined);
        await queryRunner.query(`DROP TABLE "bbb_server"`, undefined);
   }

}
