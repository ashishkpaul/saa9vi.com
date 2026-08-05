import {MigrationInterface, QueryRunner} from "typeorm";

export class BugsEntities1785911042011 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "review_vote_channels_channel" ("reviewVoteId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_8b0ceae737809dcb7e63b700e4f" PRIMARY KEY ("reviewVoteId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_4aee77e1de3ceb65593241e927" ON "review_vote_channels_channel" ("reviewVoteId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_9edcbcfcc10a05195a556c437d" ON "review_vote_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "product_review_channels_channel" ("productReviewId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_51967ecef2ea2023aca155a0fe5" PRIMARY KEY ("productReviewId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_a45e8e994441d0dd092c0397ec" ON "product_review_channels_channel" ("productReviewId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_4bbb0b9750bf5fea5ead93dd2b" ON "product_review_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "review_request_channels_channel" ("reviewRequestId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_36086fd93f1da4955a3eaade949" PRIMARY KEY ("reviewRequestId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b25a5b06eccfb3ed819557d047" ON "review_request_channels_channel" ("reviewRequestId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b037eb9cb948961d70631f26d5" ON "review_request_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "review_report_channels_channel" ("reviewReportId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_ad868f02704cb7b6f8b3b867784" PRIMARY KEY ("reviewReportId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_50350ca06052e86e1545007157" ON "review_report_channels_channel" ("reviewReportId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_528c6c53691c8dbc3449c2fbfd" ON "review_report_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`CREATE TABLE "review_reward_channels_channel" ("reviewRewardId" integer NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_a9c3fcf38892a20745f91610e28" PRIMARY KEY ("reviewRewardId", "channelId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_66734ddca1554a53083c00d1f5" ON "review_reward_channels_channel" ("reviewRewardId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_be1dae88e2945f3a26910b64cb" ON "review_reward_channels_channel" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "review_vote" ADD "channelId" character varying NOT NULL`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review" ADD "channelId" character varying NOT NULL`, undefined);
        await queryRunner.query(`ALTER TABLE "review_report" ADD "channelId" character varying NOT NULL`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward" ADD "channelId" character varying NOT NULL`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_review_vote_channel" ON "review_vote" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_review_channel" ON "product_review" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_review_request_channel" ON "review_request" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "idx_review_report_channel" ON "review_report" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "idx_review_reward_channel" ON "review_reward" ("channelId") `, undefined);
        await queryRunner.query(`ALTER TABLE "review_vote_channels_channel" ADD CONSTRAINT "FK_4aee77e1de3ceb65593241e927b" FOREIGN KEY ("reviewVoteId") REFERENCES "review_vote"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "review_vote_channels_channel" ADD CONSTRAINT "FK_9edcbcfcc10a05195a556c437d8" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review_channels_channel" ADD CONSTRAINT "FK_a45e8e994441d0dd092c0397ecb" FOREIGN KEY ("productReviewId") REFERENCES "product_review"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review_channels_channel" ADD CONSTRAINT "FK_4bbb0b9750bf5fea5ead93dd2be" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "review_request_channels_channel" ADD CONSTRAINT "FK_b25a5b06eccfb3ed819557d047b" FOREIGN KEY ("reviewRequestId") REFERENCES "review_request"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "review_request_channels_channel" ADD CONSTRAINT "FK_b037eb9cb948961d70631f26d5c" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "review_report_channels_channel" ADD CONSTRAINT "FK_50350ca06052e86e15450071570" FOREIGN KEY ("reviewReportId") REFERENCES "review_report"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "review_report_channels_channel" ADD CONSTRAINT "FK_528c6c53691c8dbc3449c2fbfd4" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward_channels_channel" ADD CONSTRAINT "FK_66734ddca1554a53083c00d1f5f" FOREIGN KEY ("reviewRewardId") REFERENCES "review_reward"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward_channels_channel" ADD CONSTRAINT "FK_be1dae88e2945f3a26910b64cb7" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "review_reward_channels_channel" DROP CONSTRAINT "FK_be1dae88e2945f3a26910b64cb7"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward_channels_channel" DROP CONSTRAINT "FK_66734ddca1554a53083c00d1f5f"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_report_channels_channel" DROP CONSTRAINT "FK_528c6c53691c8dbc3449c2fbfd4"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_report_channels_channel" DROP CONSTRAINT "FK_50350ca06052e86e15450071570"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_request_channels_channel" DROP CONSTRAINT "FK_b037eb9cb948961d70631f26d5c"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_request_channels_channel" DROP CONSTRAINT "FK_b25a5b06eccfb3ed819557d047b"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review_channels_channel" DROP CONSTRAINT "FK_4bbb0b9750bf5fea5ead93dd2be"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review_channels_channel" DROP CONSTRAINT "FK_a45e8e994441d0dd092c0397ecb"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_vote_channels_channel" DROP CONSTRAINT "FK_9edcbcfcc10a05195a556c437d8"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_vote_channels_channel" DROP CONSTRAINT "FK_4aee77e1de3ceb65593241e927b"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."idx_review_reward_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."idx_review_report_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_review_request_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_review_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_review_vote_channel"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward" DROP COLUMN "channelId"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_report" DROP COLUMN "channelId"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review" DROP COLUMN "channelId"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_vote" DROP COLUMN "channelId"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_be1dae88e2945f3a26910b64cb"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_66734ddca1554a53083c00d1f5"`, undefined);
        await queryRunner.query(`DROP TABLE "review_reward_channels_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_528c6c53691c8dbc3449c2fbfd"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_50350ca06052e86e1545007157"`, undefined);
        await queryRunner.query(`DROP TABLE "review_report_channels_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b037eb9cb948961d70631f26d5"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b25a5b06eccfb3ed819557d047"`, undefined);
        await queryRunner.query(`DROP TABLE "review_request_channels_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_4bbb0b9750bf5fea5ead93dd2b"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_a45e8e994441d0dd092c0397ec"`, undefined);
        await queryRunner.query(`DROP TABLE "product_review_channels_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9edcbcfcc10a05195a556c437d"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_4aee77e1de3ceb65593241e927"`, undefined);
        await queryRunner.query(`DROP TABLE "review_vote_channels_channel"`, undefined);
   }

}
