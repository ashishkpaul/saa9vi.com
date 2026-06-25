import {MigrationInterface, QueryRunner} from "typeorm";

export class Review1782394117117 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "review_vote" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "isUpvote" boolean NOT NULL, "id" SERIAL NOT NULL, "reviewId" integer, "customerId" integer, CONSTRAINT "UQ_38a9a7046d9321d806f61fdb354" UNIQUE ("reviewId", "customerId"), CONSTRAINT "PK_d8afb9d60b9eb3491795ec306b5" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "product_review" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "summary" character varying NOT NULL, "body" text NOT NULL, "rating" integer NOT NULL, "authorName" character varying NOT NULL, "authorLocation" character varying, "upvotes" integer NOT NULL DEFAULT '0', "downvotes" integer NOT NULL DEFAULT '0', "state" character varying NOT NULL DEFAULT 'new', "verifiedPurchase" boolean NOT NULL DEFAULT false, "isIncentivized" boolean NOT NULL DEFAULT false, "editedAt" TIMESTAMP, "response" text, "responseCreatedAt" TIMESTAMP, "id" SERIAL NOT NULL, "productId" integer, "productVariantId" integer, "orderId" integer, "orderLineId" integer, "authorId" integer, CONSTRAINT "PK_6c00bd3bbee662e1f7a97dbce9a" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_review_product_customer" ON "product_review" ("productId", "authorId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_review_state" ON "product_review" ("state") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_review_product_state" ON "product_review" ("productId", "state") `, undefined);
        await queryRunner.query(`CREATE TABLE "review_request" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "status" character varying NOT NULL DEFAULT 'scheduled', "scheduledAt" TIMESTAMP NOT NULL, "sentAt" TIMESTAMP, "reviewedAt" TIMESTAMP, "reminderCount" integer NOT NULL DEFAULT '0', "lastReminderAt" TIMESTAMP, "expiresAt" TIMESTAMP NOT NULL, "reviewToken" character varying NOT NULL, "openedAt" TIMESTAMP, "clickCount" integer NOT NULL DEFAULT '0', "channelId" character varying, "isIncentivized" boolean NOT NULL DEFAULT false, "id" SERIAL NOT NULL, "customerId" integer, "productId" integer, "orderId" integer, "orderLineId" integer, CONSTRAINT "UQ_f8ed613c4094e4eafe63502817a" UNIQUE ("reviewToken"), CONSTRAINT "UQ_review_request_customer_product_order_line" UNIQUE ("customerId", "productId", "orderLineId"), CONSTRAINT "PK_d733798466b3d8663a13a96781c" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_review_request_token" ON "review_request" ("reviewToken") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_review_request_scheduled_at" ON "review_request" ("scheduledAt") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_review_request_status" ON "review_request" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_review_request_customer_product" ON "review_request" ("customerId", "productId") `, undefined);
        await queryRunner.query(`CREATE TABLE "review_report" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "reviewId" integer NOT NULL, "reporterId" integer NOT NULL, "reason" character varying(50) NOT NULL, "description" text, "status" character varying(20) NOT NULL DEFAULT 'pending', "reviewedByAdminId" character varying, "reviewedAt" TIMESTAMP, "actionTaken" character varying(50), "adminNotes" text, "reporterIp" character varying(45), "reporterUserAgent" character varying(500), "id" SERIAL NOT NULL, CONSTRAINT "PK_f313476ee27a2c314c816242291" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "idx_review_report_reason" ON "review_report" ("reason") `, undefined);
        await queryRunner.query(`CREATE INDEX "idx_review_report_status" ON "review_report" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "idx_review_report_reporter" ON "review_report" ("reporterId") `, undefined);
        await queryRunner.query(`CREATE INDEX "idx_review_report_review" ON "review_report" ("reviewId") `, undefined);
        await queryRunner.query(`CREATE TABLE "review_reward" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "customerId" integer NOT NULL, "reviewId" integer NOT NULL, "productId" integer NOT NULL, "orderId" integer, "rewardType" character varying(50) NOT NULL, "rewardValue" numeric(10,2) NOT NULL, "currencyCode" character varying(3), "rewardCode" character varying(100), "status" character varying(20) NOT NULL DEFAULT 'pending', "grantedAt" TIMESTAMP, "expiresAt" TIMESTAMP, "redeemedAt" TIMESTAMP, "isIncentivized" boolean NOT NULL DEFAULT false, "metadata" text, "id" SERIAL NOT NULL, CONSTRAINT "UQ_a656db5989c46bfde7490dfced8" UNIQUE ("rewardCode"), CONSTRAINT "PK_e17cedbdc17728dc773c126628e" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "idx_review_reward_status" ON "review_reward" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "idx_review_reward_review" ON "review_reward" ("reviewId") `, undefined);
        await queryRunner.query(`CREATE INDEX "idx_review_reward_customer" ON "review_reward" ("customerId") `, undefined);
        await queryRunner.query(`CREATE TABLE "product_review_assets_asset" ("productReviewId" integer NOT NULL, "assetId" integer NOT NULL, CONSTRAINT "PK_b7554f8ca427e7c8ed4c5481bd5" PRIMARY KEY ("productReviewId", "assetId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_a8a5d4d2e34cb72ea8b7a0e921" ON "product_review_assets_asset" ("productReviewId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_8a7b575d8984cbcfdf76e1c648" ON "product_review_assets_asset" ("assetId") `, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsFeaturedreviewid" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsReviewrating" double precision`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsReviewcount" double precision DEFAULT '0'`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD CONSTRAINT "FK_49d195dd5e613abc1e210127a2e" FOREIGN KEY ("customFieldsFeaturedreviewid") REFERENCES "product_review"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "review_vote" ADD CONSTRAINT "FK_f714bf883874fbd00b52bf16407" FOREIGN KEY ("reviewId") REFERENCES "product_review"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "review_vote" ADD CONSTRAINT "FK_a5ebd912f54fb597a84e7cef9e5" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review" ADD CONSTRAINT "FK_06e7335708b5e7870f1eaa608d2" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review" ADD CONSTRAINT "FK_de987f9289b240e8702c9b8148e" FOREIGN KEY ("productVariantId") REFERENCES "product_variant"("id") ON DELETE SET NULL ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review" ADD CONSTRAINT "FK_b577d444e66a887fbddf4317ce6" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review" ADD CONSTRAINT "FK_348bf3e1f6a8655b8e16cbfc85d" FOREIGN KEY ("orderLineId") REFERENCES "order_line"("id") ON DELETE SET NULL ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review" ADD CONSTRAINT "FK_15a352d289533a11d67715d353a" FOREIGN KEY ("authorId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "review_request" ADD CONSTRAINT "FK_821b9fb971078922508bda7d08b" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "review_request" ADD CONSTRAINT "FK_d055a650346f402761c6e6f9762" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "review_request" ADD CONSTRAINT "FK_f4d2a97376a6536907bb97abf35" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "review_request" ADD CONSTRAINT "FK_c80786eaef425b6cbad6b4aac49" FOREIGN KEY ("orderLineId") REFERENCES "order_line"("id") ON DELETE SET NULL ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "review_report" ADD CONSTRAINT "FK_403d8d00a4706d4cf77def37b0e" FOREIGN KEY ("reviewId") REFERENCES "product_review"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "review_report" ADD CONSTRAINT "FK_69e5d130ca1b18011ffc8fc6286" FOREIGN KEY ("reporterId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward" ADD CONSTRAINT "FK_e0b060e2334074be80cb6edf06f" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward" ADD CONSTRAINT "FK_a2cd5a098d302c65bac8177f268" FOREIGN KEY ("reviewId") REFERENCES "product_review"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward" ADD CONSTRAINT "FK_c7405f10a7f692df9d49c566f25" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward" ADD CONSTRAINT "FK_4a84eaa7617bcd330da310b1935" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review_assets_asset" ADD CONSTRAINT "FK_a8a5d4d2e34cb72ea8b7a0e9211" FOREIGN KEY ("productReviewId") REFERENCES "product_review"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review_assets_asset" ADD CONSTRAINT "FK_8a7b575d8984cbcfdf76e1c6488" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "product_review_assets_asset" DROP CONSTRAINT "FK_8a7b575d8984cbcfdf76e1c6488"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review_assets_asset" DROP CONSTRAINT "FK_a8a5d4d2e34cb72ea8b7a0e9211"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward" DROP CONSTRAINT "FK_4a84eaa7617bcd330da310b1935"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward" DROP CONSTRAINT "FK_c7405f10a7f692df9d49c566f25"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward" DROP CONSTRAINT "FK_a2cd5a098d302c65bac8177f268"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_reward" DROP CONSTRAINT "FK_e0b060e2334074be80cb6edf06f"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_report" DROP CONSTRAINT "FK_69e5d130ca1b18011ffc8fc6286"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_report" DROP CONSTRAINT "FK_403d8d00a4706d4cf77def37b0e"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_request" DROP CONSTRAINT "FK_c80786eaef425b6cbad6b4aac49"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_request" DROP CONSTRAINT "FK_f4d2a97376a6536907bb97abf35"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_request" DROP CONSTRAINT "FK_d055a650346f402761c6e6f9762"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_request" DROP CONSTRAINT "FK_821b9fb971078922508bda7d08b"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review" DROP CONSTRAINT "FK_15a352d289533a11d67715d353a"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review" DROP CONSTRAINT "FK_348bf3e1f6a8655b8e16cbfc85d"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review" DROP CONSTRAINT "FK_b577d444e66a887fbddf4317ce6"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review" DROP CONSTRAINT "FK_de987f9289b240e8702c9b8148e"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_review" DROP CONSTRAINT "FK_06e7335708b5e7870f1eaa608d2"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_vote" DROP CONSTRAINT "FK_a5ebd912f54fb597a84e7cef9e5"`, undefined);
        await queryRunner.query(`ALTER TABLE "review_vote" DROP CONSTRAINT "FK_f714bf883874fbd00b52bf16407"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP CONSTRAINT "FK_49d195dd5e613abc1e210127a2e"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsReviewcount"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsReviewrating"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsFeaturedreviewid"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_8a7b575d8984cbcfdf76e1c648"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_a8a5d4d2e34cb72ea8b7a0e921"`, undefined);
        await queryRunner.query(`DROP TABLE "product_review_assets_asset"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."idx_review_reward_customer"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."idx_review_reward_review"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."idx_review_reward_status"`, undefined);
        await queryRunner.query(`DROP TABLE "review_reward"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."idx_review_report_review"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."idx_review_report_reporter"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."idx_review_report_status"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."idx_review_report_reason"`, undefined);
        await queryRunner.query(`DROP TABLE "review_report"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_review_request_customer_product"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_review_request_status"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_review_request_scheduled_at"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_review_request_token"`, undefined);
        await queryRunner.query(`DROP TABLE "review_request"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_review_product_state"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_review_state"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_review_product_customer"`, undefined);
        await queryRunner.query(`DROP TABLE "product_review"`, undefined);
        await queryRunner.query(`DROP TABLE "review_vote"`, undefined);
   }

}
