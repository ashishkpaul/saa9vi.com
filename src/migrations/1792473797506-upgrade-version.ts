import {MigrationInterface, QueryRunner} from "typeorm";
import { deduplicateTranslations } from "@vendure/core";

export class UpgradeVersion1792473797506 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        // Remove any duplicate (baseId, languageCode) translation rows left over from before the
        // unique constraint existed, keeping the most recently updated row of each pair. This must
        // run before the constraint is created below. See https://github.com/vendurehq/vendure/issues/4884
        await deduplicateTranslations(queryRunner, ["collection_translation", "facet_translation", "facet_value_translation", "product_option_translation", "product_option_group_translation", "product_translation", "asset_translation", "promotion_translation", "shipping_method_translation", "product_variant_translation", "region_translation", "api_key_translation", "payment_method_translation", "seller_translation"]);
        await queryRunner.query(`CREATE TABLE "seller_translation" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "languageCode" character varying NOT NULL, "id" SERIAL NOT NULL, "baseId" integer, CONSTRAINT "UQ_56d8e1ae8ffbb4dd28e1da595f9" UNIQUE ("languageCode", "baseId"), CONSTRAINT "PK_26aacf907d08a9990c5de57c44c" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_f54f9a5767b186b6dc21bbdee0" ON "seller_translation" ("baseId") `, undefined);
        await queryRunner.query(`ALTER TABLE "asset" ADD "usage" character varying NOT NULL DEFAULT 'LIBRARY'`, undefined);
        await queryRunner.query(`ALTER TABLE "refund" ADD "destination" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "pricingUpdatedAt" TIMESTAMP(6)`, undefined);
        await queryRunner.query(`ALTER TABLE "session" ADD "apiType" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "administrator" ADD "avatarId" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "administrator" ADD CONSTRAINT "UQ_28780e360e41381e695284b4a03" UNIQUE ("avatarId")`, undefined);
        await queryRunner.query(`ALTER TABLE "api_key" ADD "apiType" character varying`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_94e15d5f12d355d117390131ac" ON "stock_movement" ("discriminator") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_f1b165529ffe0c2cea399e25dd" ON "region" ("discriminator") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_e5598363000cab9d9116bd5835" ON "session" ("type") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_f3a761f6bcfabb474b11e1e51f" ON "history_entry" ("discriminator") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_6df70f3f2a566bcdf23c3a211a" ON "search_index_item" ("productId") `, undefined);
        await queryRunner.query(`ALTER TABLE "collection_translation" ADD CONSTRAINT "UQ_858c112351f7714960a2dfcff91" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "facet_translation" ADD CONSTRAINT "UQ_c9174d39ac643e5f14b73ad6cb5" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "facet_value_translation" ADD CONSTRAINT "UQ_084f223aa69bcd7683e727e3130" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "product_option_translation" ADD CONSTRAINT "UQ_bd426ff614344b6759d327fe58c" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "product_option_group_translation" ADD CONSTRAINT "UQ_bb3992fff02944c061363d9d015" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "product_translation" ADD CONSTRAINT "UQ_dcc35f0d2b8d422634e878b813c" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "asset_translation" ADD CONSTRAINT "UQ_0dad4e3837a685fea5062da3d96" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "promotion_translation" ADD CONSTRAINT "UQ_0d74bcbf35d65e5d7c2a7947ae1" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "shipping_method_translation" ADD CONSTRAINT "UQ_6f2a231486b87fd9d337bf9d60b" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant_translation" ADD CONSTRAINT "UQ_33042b9e7ea5dcf5ec09a5a4130" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "region_translation" ADD CONSTRAINT "UQ_fc1a4a3618bcd16cc50dd50dfeb" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "api_key_translation" ADD CONSTRAINT "UQ_0a5a4e1c3fb9547a20f34ef2240" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "payment_method_translation" ADD CONSTRAINT "UQ_5ee20e71a427f7d86e921083777" UNIQUE ("languageCode", "baseId")`, undefined);
        await queryRunner.query(`ALTER TABLE "administrator" ADD CONSTRAINT "FK_28780e360e41381e695284b4a03" FOREIGN KEY ("avatarId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "seller_translation" ADD CONSTRAINT "FK_f54f9a5767b186b6dc21bbdee0b" FOREIGN KEY ("baseId") REFERENCES "seller"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "seller_translation" DROP CONSTRAINT "FK_f54f9a5767b186b6dc21bbdee0b"`, undefined);
        await queryRunner.query(`ALTER TABLE "administrator" DROP CONSTRAINT "FK_28780e360e41381e695284b4a03"`, undefined);
        await queryRunner.query(`ALTER TABLE "payment_method_translation" DROP CONSTRAINT "UQ_5ee20e71a427f7d86e921083777"`, undefined);
        await queryRunner.query(`ALTER TABLE "api_key_translation" DROP CONSTRAINT "UQ_0a5a4e1c3fb9547a20f34ef2240"`, undefined);
        await queryRunner.query(`ALTER TABLE "region_translation" DROP CONSTRAINT "UQ_fc1a4a3618bcd16cc50dd50dfeb"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant_translation" DROP CONSTRAINT "UQ_33042b9e7ea5dcf5ec09a5a4130"`, undefined);
        await queryRunner.query(`ALTER TABLE "shipping_method_translation" DROP CONSTRAINT "UQ_6f2a231486b87fd9d337bf9d60b"`, undefined);
        await queryRunner.query(`ALTER TABLE "promotion_translation" DROP CONSTRAINT "UQ_0d74bcbf35d65e5d7c2a7947ae1"`, undefined);
        await queryRunner.query(`ALTER TABLE "asset_translation" DROP CONSTRAINT "UQ_0dad4e3837a685fea5062da3d96"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_translation" DROP CONSTRAINT "UQ_dcc35f0d2b8d422634e878b813c"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_option_group_translation" DROP CONSTRAINT "UQ_bb3992fff02944c061363d9d015"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_option_translation" DROP CONSTRAINT "UQ_bd426ff614344b6759d327fe58c"`, undefined);
        await queryRunner.query(`ALTER TABLE "facet_value_translation" DROP CONSTRAINT "UQ_084f223aa69bcd7683e727e3130"`, undefined);
        await queryRunner.query(`ALTER TABLE "facet_translation" DROP CONSTRAINT "UQ_c9174d39ac643e5f14b73ad6cb5"`, undefined);
        await queryRunner.query(`ALTER TABLE "collection_translation" DROP CONSTRAINT "UQ_858c112351f7714960a2dfcff91"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_6df70f3f2a566bcdf23c3a211a"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_f3a761f6bcfabb474b11e1e51f"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e5598363000cab9d9116bd5835"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_f1b165529ffe0c2cea399e25dd"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_94e15d5f12d355d117390131ac"`, undefined);
        await queryRunner.query(`ALTER TABLE "api_key" DROP COLUMN "apiType"`, undefined);
        await queryRunner.query(`ALTER TABLE "administrator" DROP CONSTRAINT "UQ_28780e360e41381e695284b4a03"`, undefined);
        await queryRunner.query(`ALTER TABLE "administrator" DROP COLUMN "avatarId"`, undefined);
        await queryRunner.query(`ALTER TABLE "session" DROP COLUMN "apiType"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "pricingUpdatedAt"`, undefined);
        await queryRunner.query(`ALTER TABLE "refund" DROP COLUMN "destination"`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "usage"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_f54f9a5767b186b6dc21bbdee0"`, undefined);
        await queryRunner.query(`DROP TABLE "seller_translation"`, undefined);
   }

}
