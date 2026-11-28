import {MigrationInterface, QueryRunner} from "typeorm";

export class AddKeycloakIdentityTable1795865197 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "keycloak_identity" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "issuer" character varying NOT NULL, "subject" character varying NOT NULL, "customerId" character varying, "administratorId" character varying, CONSTRAINT "PK_3e1f8a7b2c4d6e8f0a1b2c3d4e5f6a7b" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_keycloak_identity_issuer_subject" ON "keycloak_identity" ("issuer", "subject") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_keycloak_identity_channelId" ON "keycloak_identity" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_keycloak_identity_customerId" ON "keycloak_identity" ("customerId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_keycloak_identity_administratorId" ON "keycloak_identity" ("administratorId") `, undefined);
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "IDX_keycloak_identity_administratorId"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_keycloak_identity_customerId"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_keycloak_identity_channelId"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_keycloak_identity_issuer_subject"`, undefined);
        await queryRunner.query(`DROP TABLE "keycloak_identity"`, undefined);
    }

}
