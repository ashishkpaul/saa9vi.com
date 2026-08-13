/**
 * Seed Script: Demo Academy Creation (Layer 1)
 *
 * Uses Vendure services directly to establish a deterministic demo environment
 * respecting domain invariants:
 *   Channel (Tenant) -> TenantProfile -> InstructorProfile -> BBB Org -> Products/Variants -> Customer/Order
 */
import 'reflect-metadata';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  bootstrapWorker,
  ChannelService,
  RequestContextService,
  ProductService,
  ProductVariantService,
  CustomerService,
  LanguageCode,
  TransactionalConnection,
} from '@vendure/core';
import { config } from '../../src/vendure-config';
import { TenantRegistrationService } from '../../src/plugins/tenant-plugin/services/tenant-registration.service';
import { TenantProfileService } from '../../src/plugins/tenant-plugin/services/tenant-profile.service';
import { InstructorProfileService } from '../../src/plugins/tenant-plugin/services/instructor-profile.service';
import { BbbOrganizationService } from '../../src/plugins/bigbluebutton-plugin/services/bbb-organization.service';
import { BbbScheduledSession } from '../../src/plugins/bigbluebutton-plugin/entities/bbb-scheduled-session.entity';
import { BbbOrganizationMember } from '../../src/plugins/bigbluebutton-plugin/entities/bbb-organization-member.entity';

const FIXTURE_FILE = '/tmp/demo-data.json';

async function seedDemoAcademy() {
  console.log('=== Layer 1: Seeding Demo Academy Data ===');

  // Safety check: Avoid running in strict production environments unless explicitly allowed
  if (process.env.NODE_ENV === 'production' && process.env.SAA9VI_ALLOW_DEMO_SEED !== 'true') {
    throw new Error(
      '[Seed Error]: Refusing to run demo seed in production without SAA9VI_ALLOW_DEMO_SEED=true'
    );
  }

  const worker = await bootstrapWorker(config, {
    nestApplicationContextOptions: {
      logger: false,
    },
  });

  try {
    const connection = worker.app.get(TransactionalConnection);
    const channelService = worker.app.get(ChannelService);
    const reqCtxService = worker.app.get(RequestContextService);
    const tenantRegService = worker.app.get(TenantRegistrationService);
    const tenantProfileService = worker.app.get(TenantProfileService);
    const instructorService = worker.app.get(InstructorProfileService);
    const bbbOrgService = worker.app.get(BbbOrganizationService);
    const productService = worker.app.get(ProductService);
    const productVariantService = worker.app.get(ProductVariantService);
    const customerService = worker.app.get(CustomerService);

    // Obtain default channel context
    const defaultChannel = await channelService.getDefaultChannel();
    const defaultCtx = await reqCtxService.create({
      apiType: 'admin',
      channelOrToken: defaultChannel,
    });

    console.log(`[Seed] Operating under Default Channel ID: ${defaultChannel.id}`);

    // 1. Check/Register Demo Tenant Channel
    const moderatorEmail = process.env.DEMO_MODERATOR_EMAIL ?? 'apex.moderator@example.com';
    const moderatorPassword = process.env.DEMO_MODERATOR_PASSWORD ?? 'DemoModerator123!';
    const instructorEmail = process.env.DEMO_INSTRUCTOR_EMAIL ?? 'apex.instructor@example.com';
    const instructorPassword = process.env.DEMO_INSTRUCTOR_PASSWORD ?? 'DemoInstructor123!';
    const customerEmail = process.env.DEMO_CUSTOMER_EMAIL ?? 'apex.customer@example.com';
    const customerPassword = process.env.DEMO_CUSTOMER_PASSWORD ?? 'DemoCustomer123!';

    const existingChannels = await channelService.findAll(defaultCtx);
    let demoChannel = existingChannels.items.find(
      (c) => c.code === 'apex-academy' || c.token === 'apex-academy'
    );

    let channelToken = 'apex-academy';
    let channelId = demoChannel?.id;

    if (!demoChannel) {
      console.log(`[Seed] Creating demo tenant "Apex Academy" with moderator "${moderatorEmail}"...`);
      try {
        const regResult = await tenantRegService.registerTenant(
          defaultCtx,
          {
            businessName: 'Apex Academy',
            firstName: 'Apex',
            lastName: 'Admin',
            emailAddress: moderatorEmail,
            password: moderatorPassword,
            contactEmail: 'contact@apexacademy.io',
          }
        );
        channelId = regResult.channelId;
        channelToken = String(regResult.channelToken);
        console.log(`[Seed] Created Channel ID: ${channelId}, Token: ${channelToken}`);
      } catch (err: any) {
        if (err?.message?.includes('already exist') || err?.message?.includes('details could not be created')) {
          throw new Error(
            `[Seed Error]: Cannot register tenant "Apex Academy" with email "${moderatorEmail}" because that account already exists in the database outside the "apex-academy" channel. Please specify a distinct DEMO_MODERATOR_EMAIL environment variable.`
          );
        }
        throw err;
      }
    } else {
      console.log(`[Seed] Demo tenant "Apex Academy" already exists (Channel ID: ${channelId}).`);
    }

    // Tenant-scoped context
    const tenantChannel = await channelService.findOne(defaultCtx, channelId!);
    const tenantCtx = await reqCtxService.create({
      apiType: 'admin',
      channelOrToken: tenantChannel!,
    });

    // 2. TenantProfile verification
    const tenantProfile = await tenantProfileService.findByChannelId(tenantCtx, channelId!);
    console.log(`[Seed] Tenant Profile verified (ID: ${tenantProfile?.id ?? 'n/a'})`);

    // 3. Demo Instructor Customer Account
    const existingInstructors = await customerService.findAll(tenantCtx, {
      filter: { emailAddress: { eq: instructorEmail } },
      take: 1,
    });
    let instructorCustomer = existingInstructors.items[0];

    if (!instructorCustomer) {
      console.log(`[Seed] Creating Instructor Customer: ${instructorEmail}...`);
      const createRes = await customerService.create(
        tenantCtx,
        {
          firstName: 'John',
          lastName: 'Doe',
          emailAddress: instructorEmail,
        },
        instructorPassword
      );
      if ('id' in createRes) {
        instructorCustomer = createRes;
      } else {
        throw new Error(`[Seed Error] Instructor customer creation failed: ${(createRes as any).message || 'Unknown error'}`);
      }
    } else {
      console.log(`[Seed] Instructor Customer "${instructorEmail}" verified (ID: ${instructorCustomer.id}).`);
    }

    // 4. Instructor Profile (Linked to Instructor Customer)
    let instructorSlug = 'john-doe';
    const existingInstructor = await instructorService.findPublicBySlug(tenantCtx, instructorSlug);
    if (!existingInstructor) {
      console.log('[Seed] Creating Instructor Profile: John Doe...');
      await instructorService.create(tenantCtx, {
        customerId: String(instructorCustomer.id),
        fullName: 'John Doe',
        slug: instructorSlug,
        credentials: 'Lead Python Instructor',
        bio: 'Senior Software Architect and Bootcamp Lead.',
        isPublic: true,
        isActive: true,
      });
    } else {
      console.log(`[Seed] Instructor Profile verified (ID: ${existingInstructor.id}).`);
    }

    // 5. BBB Organization
    let bbbOrg = await bbbOrgService.findByChannelId(tenantCtx, channelId!);
    if (!bbbOrg && tenantProfile) {
      console.log('[Seed] Creating BBB Organization for Apex Academy...');
      bbbOrg = await bbbOrgService.create(tenantCtx, {
        channelId: String(channelId),
        tenantProfileId: String(tenantProfile.id),
        slug: 'apex-academy',
        name: 'Apex Academy Live Classroom',
        concurrentMeetingLimit: 10,
        maxParticipantsPerMeeting: 100,
        recordingEnabled: true,
      });
    }

    // 6. Product Catalog (Python Masterclass) & Variant
    let productSlug = 'python-masterclass';
    const productsResult = await productService.findAll(tenantCtx, {
      take: 10,
    });
    let product = productsResult.items.find((p) => p.slug === productSlug);

    if (!product) {
      console.log('[Seed] Creating Demo Course Product: Python Masterclass...');
      product = await productService.create(tenantCtx, {
        enabled: true,
        translations: [
          {
            languageCode: LanguageCode.en,
            name: 'Python Masterclass',
            slug: productSlug,
            description: 'Comprehensive Python Bootcamp with Live BBB Workshops.',
          },
        ],
      });

      // Create Product Variant
      await productVariantService.create(tenantCtx, [
        {
          productId: product.id,
          sku: 'PY-BOOTCAMP-01',
          price: 9900, // $99.00
          translations: [
            {
              languageCode: LanguageCode.en,
              name: 'Live Cohort Access',
            },
          ],
        },
      ]);
    }

    const variants = await productVariantService.getVariantsByProductId(tenantCtx, product.id);
    const variant = variants.items[0];

    // 7. Demo Student Customer (Idempotent Lookup by Email)
    const existingCustomers = await customerService.findAll(tenantCtx, {
      filter: { emailAddress: { eq: customerEmail } },
      take: 1,
    });
    let customer = existingCustomers.items[0];

    if (!customer) {
      console.log(`[Seed] Creating Student Customer: ${customerEmail}...`);
      const createRes = await customerService.create(
        tenantCtx,
        {
          firstName: 'Apex',
          lastName: 'Learner',
          emailAddress: customerEmail,
        },
        customerPassword
      );
      if ('id' in createRes) {
        customer = createRes;
      } else {
        throw new Error(`[Seed Error] Customer creation failed: ${(createRes as any).message || 'Unknown error'}`);
      }
    } else {
      console.log(`[Seed] Student Customer "${customerEmail}" verified (ID: ${customer.id}).`);
    }

    // 8. BbbScheduledSession (Commercial Product Entity Linking to BBB Org)
    let session: BbbScheduledSession | null = null;
    if (bbbOrg) {
      const sessionRepo = connection.getRepository(tenantCtx, BbbScheduledSession);
      session = await sessionRepo.findOne({
        where: {
          organization: { id: bbbOrg.id as string },
          title: 'Python Masterclass Live Session 01',
        },
      });

      if (!session) {
        console.log('[Seed] Creating BbbScheduledSession for Python Masterclass...');
        const memberRepo = connection.getRepository(tenantCtx, BbbOrganizationMember);
        let trainer = await memberRepo.findOne({
          where: { organization: { id: bbbOrg.id as string }, role: 'TRAINER' as any },
        });

        if (!trainer && instructorCustomer) {
          trainer = await memberRepo.save(
            new BbbOrganizationMember({
              organization: bbbOrg,
              customerId: String(instructorCustomer.id),
              role: 'TRAINER' as any,
              active: true,
            })
          );
        }

        session = await sessionRepo.save(
          new BbbScheduledSession({
            organization: bbbOrg,
            organizationId: String(bbbOrg.id),
            title: 'Python Masterclass Live Session 01',
            startTime: new Date(Date.now() + 86400000), // tomorrow
            endTime: new Date(Date.now() + 86400000 + 3600000), // 1 hour duration
            trainer: trainer ?? undefined,
            status: 'SCHEDULED',
            channelId: String(channelId),
            productVariantId: variant ? String(variant.id) : null,
          })
        );
        console.log(`[Seed] Created BbbScheduledSession ID: ${session.id}`);
      } else {
        console.log(`[Seed] BbbScheduledSession verified (ID: ${session.id}).`);
      }
    }

    // 8. Write Machine-Readable Fixture Config for Layer 2 & 3
    const fixtureData = {
      channelCode: 'apex-academy',
      channelToken: channelToken,
      channelId: String(channelId),
      moderatorEmail: moderatorEmail,
      moderatorPassword: moderatorPassword,
      instructorEmail: instructorEmail,
      instructorPassword: instructorPassword,
      customerEmail: customerEmail,
      customerPassword: customerPassword,
      productSlug: productSlug,
      variantId: variant ? String(variant.id) : null,
      sessionId: session ? String(session.id) : null,
      seededAt: new Date().toISOString(),
    };

    fs.writeFileSync(FIXTURE_FILE, JSON.stringify(fixtureData, null, 2));
    console.log(`[Seed] Written test fixture to ${FIXTURE_FILE}`);

    console.log('=== Layer 1 Seed Complete ===');
  } catch (err) {
    console.error('[Seed Error]:', err);
    process.exitCode = 1;
    throw err;
  } finally {
    await worker.app.close();
  }
}

if (require.main === module) {
  seedDemoAcademy().catch((err) => {
    console.error('[Seed Fatal]:', err);
    process.exit(1);
  });
}
