/**
 * INV-015 — Admin Dashboard GraphQL contract integrity.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * Custom Dashboard routes are hand-written GraphQL clients. When an operation
 * names a field the Admin schema does not expose, GraphQL rejects the ENTIRE
 * operation: the response contains no data at all. A component that then renders
 * `data?.someList?.items ?? []` cannot tell that rejection apart from "this tenant
 * really has no rows" — so a broken ledger renders as a clean empty table.
 *
 * That is exactly what happened to the mandates and payment-attempt screens,
 * which selected fields that never existed (`providerCustomerId`, `mandateId`,
 * `activatedAt`, `revokedAt`, `providerOrderId`, `providerTransactionId`) and to
 * the CMS page detail screen (`customFields` on `CmsPage`).
 *
 * This spec rebuilds the Admin schema in-process from the Vendure config (no
 * database required) and validates every GraphQL document found under any
 * plugin's `dashboard/` folder — typed `graphql()` documents AND raw template
 * strings, the latter being checked by nothing else in the build.
 *
 * Run:
 *   npx vitest run --config vitest.config.mts \
 *     src/plugins/subscription/__tests__/dashboard-graphql-contract.spec.ts
 */

import 'reflect-metadata';
import path from 'path';
import { GraphQLTypesLoader } from '@nestjs/graphql';
import {
  getConfig,
  getFinalVendureSchema,
  resetConfig,
  runPluginConfigurations,
  setConfig,
  VENDURE_ADMIN_API_TYPE_PATHS,
} from '@vendure/core';
import { buildSchema, GraphQLSchema } from 'graphql';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildReport, formatIssues, validateDocuments } from '../../../platform/invariants/graphql-contract.checker';
import type { DashboardContractReport } from '../../../platform/invariants/graphql-contract.checker';
import { config } from '../../../vendure-config';

/** Repository root: src/plugins/subscription/__tests__ → up four levels. */
const ROOT = path.resolve(__dirname, '../../../..');

/**
 * Files that still pass raw, build-time-unchecked GraphQL strings. This is a
 * RATCHET, not an allowlist: migrating a file to the typed `graphql()` helper
 * makes the check pass, adding a NEW untyped document fails.
 *
 * Shrink this list as screens are migrated — never grow it.
 */
const UNTYPED_DOCUMENT_BASELINE = new Set<string>([
  'src/plugins/bigbluebutton-plugin/dashboard/routes/enrollments/EnrollmentsList.tsx',
  'src/plugins/bigbluebutton-plugin/dashboard/routes/entitlements/EntitlementsList.tsx',
  'src/plugins/bigbluebutton-plugin/dashboard/routes/meetings/MeetingsList.tsx',
  'src/plugins/bigbluebutton-plugin/dashboard/routes/members/MembersList.tsx',
  'src/plugins/bigbluebutton-plugin/dashboard/routes/memberships/MembershipsList.tsx',
  'src/plugins/bigbluebutton-plugin/dashboard/routes/organizations/OrganizationsList.tsx',
  'src/plugins/bigbluebutton-plugin/dashboard/routes/plans/PlansList.tsx',
  'src/plugins/bigbluebutton-plugin/dashboard/routes/rooms/RoomsList.tsx',
  'src/plugins/bigbluebutton-plugin/dashboard/routes/servers/ServersList.tsx',
  'src/plugins/bigbluebutton-plugin/dashboard/routes/sessions/SessionDetail.tsx',
  'src/plugins/bigbluebutton-plugin/dashboard/routes/sessions/SessionsList.tsx',
  'src/plugins/marketplace/dashboard/attendance-overview.tsx',
  'src/plugins/marketplace/dashboard/attendance-session-detail.tsx',
  'src/plugins/marketplace/dashboard/spend-report.tsx',
  'src/plugins/marketplace/dashboard/wallet.tsx',
  'src/plugins/reviews/dashboard/review-detail.tsx',
  'src/plugins/reviews/dashboard/review-list.tsx',
  'src/plugins/tenant-plugin/dashboard/routes/instructors/InstructorsList.tsx',
  'src/plugins/tenant-plugin/dashboard/routes/media/MediaResourcesList.tsx',
  'src/plugins/tenant-plugin/dashboard/routes/tenant-profiles/TenantProfileDetail.tsx',
  'src/plugins/tenant-plugin/dashboard/shared/academy-dashboard.tsx',
]);

/** The tenant-scoped financial ledgers that started this investigation. */
const LEDGER_SCREENS = [
  'src/plugins/subscription/dashboard/routes/mandates/MandatesList.tsx',
  'src/plugins/subscription/dashboard/routes/attempts/PaymentAttemptsList.tsx',
  'src/plugins/subscription/dashboard/routes/reconciliation/ReconciliationList.tsx',
  'src/plugins/subscription/dashboard/routes/subscriptions/SubscriptionsList.tsx',
];

const CHANNEL_SCOPED_OPERATIONS = [
  'providerMandates',
  'providerPaymentAttempts',
  'reconciliationIncidents',
];

let schema: GraphQLSchema;
let report: DashboardContractReport;

beforeAll(async () => {
  // Mirrors @vendure/dashboard/vite `schema-generator.ts`: normalise the Vendure
  // config, run plugin configuration hooks, then build the Admin API SDL.
  resetConfig();
  await setConfig(config as any);
  const runtimeConfig = await runPluginConfigurations(getConfig());

  const sdl = await getFinalVendureSchema({
    config: runtimeConfig,
    typePaths: VENDURE_ADMIN_API_TYPE_PATHS as unknown as string[],
    typesLoader: new GraphQLTypesLoader(),
    apiType: 'admin',
    output: 'sdl',
  });

  schema = buildSchema(sdl);
  report = buildReport(schema, 'vendure-config (in-process)', ROOT);
}, 180_000);


describe('Admin Dashboard GraphQL contract (INV-015)', () => {
  it('finds the Dashboard documents to check (guards against a silently empty scan)', () => {
    // A refactor that moves documents out of `dashboard/` would otherwise turn
    // this whole spec into a no-op that always passes.
    expect(report.documents.length).toBeGreaterThan(80);
    expect(report.documents.filter(document => document.typed).length).toBeGreaterThan(10);
  });

  it('validates every Dashboard GraphQL document against the Admin schema', () => {
    const summary = report.issues.length
      ? `\nInvalid Dashboard documents (a GraphQL rejection renders as an empty dataset):\n${formatIssues(report.issues)}\n`
      : '';

    expect(report.issues, summary).toEqual([]);
  });

  it('exposes every field the subscription ledger screens select', () => {
    const expectFields = (typeName: string, expected: string[]) => {
      const type = schema.getType(typeName) as any;
      expect(type, `${typeName} missing from Admin schema`).toBeDefined();
      expect(Object.keys(type.getFields()).sort()).toEqual(expected.sort());
    };

    expectFields('ProviderMandate', [
      'id',
      'createdAt',
      'updatedAt',
      'channelId',
      'subscriptionId',
      'provider',
      'providerSubscriptionId',
      'providerPlanId',
      'providerStatus',
      'active',
    ]);

    expectFields('ProviderPaymentAttempt', [
      'id',
      'createdAt',
      'updatedAt',
      'channelId',
      'subscriptionId',
      'provider',
      'providerSubscriptionId',
      'providerPaymentId',
      'providerInvoiceId',
      'providerEventId',
      'providerAttemptId',
      'invoiceId',
      'billingPeriodStart',
      'amountPaise',
      'status',
      'failureReason',
      'attemptedAt',
    ]);

    expectFields('RenewalPaymentReconciliationRequired', [
      'id',
      'createdAt',
      'channelId',
      'subscriptionId',
      'invoiceId',
      'providerOrderId',
      'detectedAt',
      'resolutionNote',
      'status',
    ]);
  });

  it('keeps the fields that never existed out of the schema', () => {
    const forbidden: Array<[string, string[]]> = [
      ['ProviderMandate', ['providerCustomerId', 'mandateId', 'activatedAt', 'revokedAt']],
      ['ProviderPaymentAttempt', ['providerOrderId', 'providerTransactionId']],
      ['CmsPage', ['customFields']],
    ];

    for (const [typeName, fieldNames] of forbidden) {
      const type = schema.getType(typeName) as any;
      expect(type, `${typeName} must exist in the Admin schema`).toBeDefined();
      for (const fieldName of fieldNames) {
        expect(
          Object.keys(type.getFields()),
          `${typeName}.${fieldName} was queried by the Dashboard but is not in the schema`,
        ).not.toContain(fieldName);
      }
    }
  });

  it('catches the original failure mode: an unknown field is reported, never ignored', () => {
    // Guards the detector itself — this is the exact shape of the bug that
    // produced a silently empty mandates table.
    const broken = [
      {
        file: 'src/plugins/subscription/dashboard/routes/mandates/MandatesList.tsx',
        line: 1,
        operationName: 'BrokenMandates',
        typed: true,
        body: `query BrokenMandates($channelId: String!) {
          providerMandates(channelId: $channelId) {
            items { id providerCustomerId mandateId activatedAt revokedAt }
          }
        }`,
      },
    ];

    const issues = validateDocuments(schema, broken);
    expect(issues).toHaveLength(1);
    expect(issues[0].problems.join(' ')).toMatch(/providerCustomerId/);
    expect(issues[0].problems.join(' ')).toMatch(/mandateId/);
  });

  it('requires a channel argument on every channel-scoped ledger call', () => {
    // INV-001 (Channel = Tenant): a ledger query without a channel selector
    // would leak another tenant's financial rows into the screen.
    const offenders = report.documents
      .filter(document => CHANNEL_SCOPED_OPERATIONS.some(op => document.body.includes(`${op}(`)))
      .filter(document => !/channelId\s*:/.test(document.body))
      .map(document => `${document.file}:${document.line} ${document.operationName}`);

    expect(offenders, 'ledger queries must pass channelId').toEqual([]);

    const queryFields = schema.getQueryType()!.getFields();

    for (const operation of ['providerMandates', 'providerPaymentAttempts']) {
      const channelArg = queryFields[operation].args.find(arg => arg.name === 'channelId');
      expect(channelArg, `${operation} must declare a channelId argument`).toBeDefined();
      expect(String(channelArg!.type)).toBe('String!');
    }

    // `reconciliationIncidents` stays nullable in the schema so operators can
    // request a platform-wide view, but the Dashboard must still scope it.
    const incidentArg = queryFields['reconciliationIncidents'].args.find(arg => arg.name === 'channelId');
    expect(incidentArg, 'reconciliationIncidents must declare a channelId argument').toBeDefined();
    expect(String(incidentArg!.type)).toBe('String');
  });



  it('declares the ledger screens with the typed graphql() helper', () => {
    for (const screen of LEDGER_SCREENS) {
      const documents = report.documents.filter(document => document.file === screen);
      expect(documents.length, `${screen} should declare at least one document`).toBeGreaterThan(0);
      expect(
        documents.filter(document => !document.typed).map(document => `${document.file}:${document.line}`),
        `${screen} must use graphql() so tsc catches schema drift at build time`,
      ).toEqual([]);
      expect(UNTYPED_DOCUMENT_BASELINE.has(screen), `${screen} must not be baselined`).toBe(false);
    }
  });

  it('does not add any new untyped (build-time-unchecked) Dashboard document', () => {
    const unexpected = report.untypedFiles.filter(file => !UNTYPED_DOCUMENT_BASELINE.has(file));
    const migrated = Array.from(UNTYPED_DOCUMENT_BASELINE).filter(
      file => !report.untypedFiles.includes(file),
    );

    expect(
      unexpected,
      'Declare new Dashboard documents with graphql() from "@/gql" so tsc validates them.',
    ).toEqual([]);

    expect(
      migrated,
      'These files no longer contain untyped documents — remove them from UNTYPED_DOCUMENT_BASELINE.',
    ).toEqual([]);
  });
});
