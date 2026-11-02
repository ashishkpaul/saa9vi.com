import {MigrationInterface, QueryRunner} from "typeorm";

export class AddLearningCourseTables1793596134567 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "learning_course" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying NOT NULL, "slug" character varying NOT NULL, "title" character varying NOT NULL, "description" text, "status" character varying NOT NULL DEFAULT 'DRAFT', "templateId" character varying, "createdByUserId" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_db9cf287f65d4439a383095137b" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_2038dd97d382059bb0bf6a286e" ON "learning_course" ("channelId", "status") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6b8728bf5e447bf5489914dc12" ON "learning_course" ("channelId", "slug") `, undefined);
        await queryRunner.query(`CREATE TABLE "course_template" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" character varying, "name" character varying NOT NULL, "description" text, "isDefault" boolean NOT NULL DEFAULT false, "id" SERIAL NOT NULL, CONSTRAINT "PK_f2b0bd8e93358f6f4e1486a8e7c" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_605345e699aa8707a2e4feef10" ON "course_template" ("channelId", "name") `, undefined);
        await queryRunner.query(`CREATE TABLE "course_template_tool" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "templateId" character varying NOT NULL, "toolKey" character varying NOT NULL, "order" integer NOT NULL DEFAULT '0', "visibility" character varying NOT NULL DEFAULT 'VISIBLE', "settings" jsonb, "id" SERIAL NOT NULL, CONSTRAINT "PK_418d05eee453d44d9a65edd8d78" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_6005488534b21846e7a209b44f" ON "course_template_tool" ("templateId") `, undefined);
        await queryRunner.query(`CREATE TABLE "course_tool" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "courseId" character varying NOT NULL, "toolKey" character varying NOT NULL, "order" integer NOT NULL DEFAULT '0', "visibility" character varying NOT NULL DEFAULT 'VISIBLE', "settings" jsonb, "id" SERIAL NOT NULL, CONSTRAINT "PK_ad8442731f1576197f5b8710021" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_9189aef2d7ff668b245fc6d9a4" ON "course_tool" ("courseId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f4b3e0931e849765601f73b6f3" ON "course_tool" ("courseId", "toolKey") `, undefined);
        await queryRunner.query(`CREATE TABLE "course_enrollment" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "courseId" character varying NOT NULL, "customerId" character varying NOT NULL, "channelId" character varying NOT NULL, "courseRole" character varying NOT NULL DEFAULT 'LEARNER', "status" character varying NOT NULL DEFAULT 'INVITED', "invitedByUserId" character varying, "enrolledAt" TIMESTAMP, "id" SERIAL NOT NULL, CONSTRAINT "PK_3ae773370689173c290163de513" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_010244a6a5b22dc0543de017f8" ON "course_enrollment" ("channelId", "status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_5cd701b38910026d526e6be323" ON "course_enrollment" ("channelId", "customerId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_52b3a682168d98fc3b062c3cdb" ON "course_enrollment" ("courseId", "customerId") `, undefined);
        await queryRunner.query(`CREATE TABLE "course_scheduled_session" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "courseId" character varying NOT NULL, "sessionId" character varying NOT NULL, "channelId" character varying NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "PK_9dd4717e8557570ed1a97534a85" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_abd490c8fa5408a25a4432a263" ON "course_scheduled_session" ("channelId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c65b4002080394d1260b741f7e" ON "course_scheduled_session" ("courseId", "sessionId") `, undefined);
        await queryRunner.query(`CREATE TABLE "course_announcement" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "courseId" character varying NOT NULL, "channelId" character varying NOT NULL, "title" character varying NOT NULL, "body" text NOT NULL, "status" character varying NOT NULL DEFAULT 'DRAFT', "publishedAt" TIMESTAMP, "authorId" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_45de69eb3bfd84f866076a5342e" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_eb62d91f10753c29d465b25775" ON "course_announcement" ("channelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_5334cc847dbce101708eaf8394" ON "course_announcement" ("courseId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_5334cc847dbce101708eaf8394"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_eb62d91f10753c29d465b25775"`, undefined);
        await queryRunner.query(`DROP TABLE "course_announcement"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_c65b4002080394d1260b741f7e"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_abd490c8fa5408a25a4432a263"`, undefined);
        await queryRunner.query(`DROP TABLE "course_scheduled_session"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_52b3a682168d98fc3b062c3cdb"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_5cd701b38910026d526e6be323"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_010244a6a5b22dc0543de017f8"`, undefined);
        await queryRunner.query(`DROP TABLE "course_enrollment"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_f4b3e0931e849765601f73b6f3"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9189aef2d7ff668b245fc6d9a4"`, undefined);
        await queryRunner.query(`DROP TABLE "course_tool"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_6005488534b21846e7a209b44f"`, undefined);
        await queryRunner.query(`DROP TABLE "course_template_tool"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_605345e699aa8707a2e4feef10"`, undefined);
        await queryRunner.query(`DROP TABLE "course_template"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_6b8728bf5e447bf5489914dc12"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_2038dd97d382059bb0bf6a286e"`, undefined);
        await queryRunner.query(`DROP TABLE "learning_course"`, undefined);
   }

}
