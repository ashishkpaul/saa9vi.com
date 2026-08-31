import {MigrationInterface, QueryRunner} from "typeorm";

export class NavigationMenuAndDunningFields1788162583347 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "navigation_menu" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "items" jsonb NOT NULL DEFAULT '[]', "isActive" boolean NOT NULL DEFAULT true, "channelId" character varying NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "PK_f98b5b1f95020a89b26b10baef1" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_80ebe49b857a7cde1fede61936" ON "navigation_menu" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "navigation_menu_channels_channel" ("navigationMenuId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_226f83571d5b19126e420de10b3" PRIMARY KEY ("navigationMenuId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_8b52ad168d0583fb8a889a5222" ON "navigation_menu_channels_channel" ("navigationMenuId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_5cacb19c549c7d5cea4c243975" ON "navigation_menu_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "organization_subscription" ADD "dunningRetryCount" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "organization_subscription" ADD "lastDunningAttemptAt" TIMESTAMP`, undefined);
        await queryRunner.query(`ALTER TABLE "navigation_menu_channels_channel" ADD CONSTRAINT "FK_8b52ad168d0583fb8a889a52226" FOREIGN KEY ("navigationMenuId") REFERENCES "navigation_menu"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "navigation_menu_channels_channel" ADD CONSTRAINT "FK_5cacb19c549c7d5cea4c243975d" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "navigation_menu_channels_channel" DROP CONSTRAINT "FK_5cacb19c549c7d5cea4c243975d"`, undefined);
        await queryRunner.query(`ALTER TABLE "navigation_menu_channels_channel" DROP CONSTRAINT "FK_8b52ad168d0583fb8a889a52226"`, undefined);
        await queryRunner.query(`ALTER TABLE "organization_subscription" DROP COLUMN "lastDunningAttemptAt"`, undefined);
        await queryRunner.query(`ALTER TABLE "organization_subscription" DROP COLUMN "dunningRetryCount"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_5cacb19c549c7d5cea4c243975"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_8b52ad168d0583fb8a889a5222"`, undefined);
        await queryRunner.query(`DROP TABLE "navigation_menu_channels_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_80ebe49b857a7cde1fede61936"`, undefined);
        await queryRunner.query(`DROP TABLE "navigation_menu"`, undefined);
   }

}
