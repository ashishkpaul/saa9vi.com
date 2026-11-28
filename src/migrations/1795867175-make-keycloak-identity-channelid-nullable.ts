import {MigrationInterface, QueryRunner} from "typeorm";

export class MakeKeycloakIdentityChannelIdNullable1795867175 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "keycloak_identity" ALTER COLUMN "channelId" DROP NOT NULL`, undefined);
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "keycloak_identity" ALTER COLUMN "channelId" SET NOT NULL`, undefined);
    }

}
