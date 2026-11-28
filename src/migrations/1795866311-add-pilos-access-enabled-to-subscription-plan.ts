import {MigrationInterface, QueryRunner} from "typeorm";

export class AddPilosAccessEnabledToSubscriptionPlan1795866311 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "subscription_plan" ADD "pilosAccessEnabled" boolean NOT NULL DEFAULT false`, undefined);
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "subscription_plan" DROP COLUMN "pilosAccessEnabled"`, undefined);
    }

}
