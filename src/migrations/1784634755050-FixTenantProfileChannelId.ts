import {MigrationInterface, QueryRunner} from "typeorm";

export class FixTenantProfileChannelId1784634755050 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        // TypeORM generates DROP/ADD for column type changes, which is destructive.
        // The entity defines @Column('varchar', { length: 255 }) but the DB column
        // is character varying without length. We use ALTER COLUMN TYPE to safely
        // add the length constraint without losing existing data.
        await queryRunner.query(`ALTER TABLE "tenant_profile" ALTER COLUMN "channelId" TYPE character varying(255)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "tenant_profile" ALTER COLUMN "channelId" TYPE character varying`, undefined);
   }

}
