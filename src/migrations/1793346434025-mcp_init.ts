import {MigrationInterface, QueryRunner} from "typeorm";

export class McpInit1793346434025 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "mcp_oauth_client" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "clientId" character varying(512) NOT NULL, "clientName" character varying NOT NULL, "clientUri" character varying, "logoUri" character varying, "redirectUris" text NOT NULL, "grantTypes" text NOT NULL, "tokenEndpointAuthMethod" character varying NOT NULL DEFAULT 'none', "cimdDocumentExpiresAt" TIMESTAMP, "lastUsedAt" TIMESTAMP, "id" SERIAL NOT NULL, CONSTRAINT "PK_779bfe67dd46793eaf526e1bc21" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3505ecab2419d9b10556a37e68" ON "mcp_oauth_client" ("clientId") `, undefined);
        await queryRunner.query(`CREATE TABLE "mcp_oauth_grant" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "accessTokenHash" character varying NOT NULL, "refreshTokenHash" character varying NOT NULL, "previousRefreshTokenHash" character varying, "actorType" character varying NOT NULL, "resource" character varying NOT NULL, "accessTokenExpiresAt" TIMESTAMP NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "revokedAt" TIMESTAMP, "lastActivityAt" TIMESTAMP NOT NULL, "id" SERIAL NOT NULL, "oauthClientId" integer NOT NULL, "actorId" integer NOT NULL, "vendureSessionId" integer NOT NULL, "channelId" integer, CONSTRAINT "PK_abaae449e0e89822abe517ef2f0" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b660f87c580a174b17dedfacd9" ON "mcp_oauth_grant" ("accessTokenHash") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9c54a2635d0f822e634bbef59a" ON "mcp_oauth_grant" ("refreshTokenHash") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_63855f26584f837c874005d338" ON "mcp_oauth_grant" ("previousRefreshTokenHash") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b41a0c64446f94462335ccb710" ON "mcp_oauth_grant" ("oauthClientId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_dac4be3faa4142dddf896e2f31" ON "mcp_oauth_grant" ("actorId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_1575db8ad50f95db31034882ce" ON "mcp_oauth_grant" ("accessTokenExpiresAt") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_351f302e84f7e90e9c3d728b4b" ON "mcp_oauth_grant" ("expiresAt") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_782ed24fbca2f7a8e2bd1cd782" ON "mcp_oauth_grant" ("revokedAt") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_d03d0dfe44cc9104200157e439" ON "mcp_oauth_grant" ("vendureSessionId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_596a3763a7082063a57718377f" ON "mcp_oauth_grant" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_9baf07acc1aee798921bcdb4bc" ON "mcp_oauth_grant" ("lastActivityAt") `, undefined);
        await queryRunner.query(`CREATE TABLE "mcp_tool_call_log" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "actor" character varying, "actorType" character varying NOT NULL, "clientIp" character varying, "toolName" character varying NOT NULL, "pluginSource" character varying, "input" text, "output" text, "durationMs" integer, "status" character varying NOT NULL, "id" SERIAL NOT NULL, "grantId" integer, "channelId" integer, "oauthClientId" integer, CONSTRAINT "PK_759d6f30cab8884b55d8bdf243a" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_c1dd8c829700941973b8174803" ON "mcp_tool_call_log" ("grantId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_61e37ea74185f5ae2d8111875d" ON "mcp_tool_call_log" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_37e7641949e069051c9d7a7c73" ON "mcp_tool_call_log" ("toolName") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_7d790876172f3c050cd00356ec" ON "mcp_tool_call_log" ("durationMs") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_7561d40de8903109e2d41f20f8" ON "mcp_tool_call_log" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_efe37ad8e2a5e0041f3ba2ca00" ON "mcp_tool_call_log" ("oauthClientId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_42b7a911917169cc195b68a291" ON "mcp_tool_call_log" ("createdAt") `, undefined);
        await queryRunner.query(`CREATE TABLE "mcp_authorization_code" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "code" character varying NOT NULL, "actorType" character varying NOT NULL, "redirectUri" character varying NOT NULL, "resource" character varying NOT NULL, "codeChallenge" character varying NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "id" SERIAL NOT NULL, "oauthClientId" integer NOT NULL, "actorId" integer NOT NULL, "channelId" integer, CONSTRAINT "PK_f477b7e38a3c9800a6d6c8bc2c4" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_541cee762466c6ba41f0e55d00" ON "mcp_authorization_code" ("code") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_675ce8a145e152b25b287277da" ON "mcp_authorization_code" ("oauthClientId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_4410a04a7bbf97cf081e455b17" ON "mcp_authorization_code" ("expiresAt") `, undefined);
        await queryRunner.query(`CREATE TABLE "mcp_authorization_request" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "requestToken" character varying NOT NULL, "redirectUri" character varying NOT NULL, "state" character varying, "codeChallenge" character varying NOT NULL, "toolset" character varying NOT NULL, "resource" character varying NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "id" SERIAL NOT NULL, "oauthClientId" integer NOT NULL, CONSTRAINT "PK_4523e31f9c5ea160b31286d349a" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1664fb84aee221fdb495b17d41" ON "mcp_authorization_request" ("requestToken") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_13d5fa9f859220746a5f8863a5" ON "mcp_authorization_request" ("oauthClientId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_1e7bc38e0fd7956601a5fdefc0" ON "mcp_authorization_request" ("expiresAt") `, undefined);
        await queryRunner.query(`ALTER TABLE "mcp_oauth_grant" ADD CONSTRAINT "FK_b41a0c64446f94462335ccb7109" FOREIGN KEY ("oauthClientId") REFERENCES "mcp_oauth_client"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "mcp_tool_call_log" ADD CONSTRAINT "FK_c1dd8c829700941973b81748038" FOREIGN KEY ("grantId") REFERENCES "mcp_oauth_grant"("id") ON DELETE SET NULL ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "mcp_tool_call_log" ADD CONSTRAINT "FK_efe37ad8e2a5e0041f3ba2ca009" FOREIGN KEY ("oauthClientId") REFERENCES "mcp_oauth_client"("id") ON DELETE SET NULL ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "mcp_authorization_code" ADD CONSTRAINT "FK_675ce8a145e152b25b287277da4" FOREIGN KEY ("oauthClientId") REFERENCES "mcp_oauth_client"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "mcp_authorization_request" ADD CONSTRAINT "FK_13d5fa9f859220746a5f8863a57" FOREIGN KEY ("oauthClientId") REFERENCES "mcp_oauth_client"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "mcp_authorization_request" DROP CONSTRAINT "FK_13d5fa9f859220746a5f8863a57"`, undefined);
        await queryRunner.query(`ALTER TABLE "mcp_authorization_code" DROP CONSTRAINT "FK_675ce8a145e152b25b287277da4"`, undefined);
        await queryRunner.query(`ALTER TABLE "mcp_tool_call_log" DROP CONSTRAINT "FK_efe37ad8e2a5e0041f3ba2ca009"`, undefined);
        await queryRunner.query(`ALTER TABLE "mcp_tool_call_log" DROP CONSTRAINT "FK_c1dd8c829700941973b81748038"`, undefined);
        await queryRunner.query(`ALTER TABLE "mcp_oauth_grant" DROP CONSTRAINT "FK_b41a0c64446f94462335ccb7109"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_1e7bc38e0fd7956601a5fdefc0"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_13d5fa9f859220746a5f8863a5"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_1664fb84aee221fdb495b17d41"`, undefined);
        await queryRunner.query(`DROP TABLE "mcp_authorization_request"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_4410a04a7bbf97cf081e455b17"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_675ce8a145e152b25b287277da"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_541cee762466c6ba41f0e55d00"`, undefined);
        await queryRunner.query(`DROP TABLE "mcp_authorization_code"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_42b7a911917169cc195b68a291"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_efe37ad8e2a5e0041f3ba2ca00"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_7561d40de8903109e2d41f20f8"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_7d790876172f3c050cd00356ec"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_37e7641949e069051c9d7a7c73"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_61e37ea74185f5ae2d8111875d"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_c1dd8c829700941973b8174803"`, undefined);
        await queryRunner.query(`DROP TABLE "mcp_tool_call_log"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9baf07acc1aee798921bcdb4bc"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_596a3763a7082063a57718377f"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_d03d0dfe44cc9104200157e439"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_782ed24fbca2f7a8e2bd1cd782"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_351f302e84f7e90e9c3d728b4b"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_1575db8ad50f95db31034882ce"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_dac4be3faa4142dddf896e2f31"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b41a0c64446f94462335ccb710"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_63855f26584f837c874005d338"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9c54a2635d0f822e634bbef59a"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b660f87c580a174b17dedfacd9"`, undefined);
        await queryRunner.query(`DROP TABLE "mcp_oauth_grant"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_3505ecab2419d9b10556a37e68"`, undefined);
        await queryRunner.query(`DROP TABLE "mcp_oauth_client"`, undefined);
   }

}
