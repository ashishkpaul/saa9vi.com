import { createRequire } from 'module';

import { InvariantRunner, AdrChecker, RfcLifecycleChecker, StoryFlowChecker, CheckResult, DashboardGraphqlContractChecker } from './index';
import { RuntimeInvariantRunner } from './event-chain/runtime-invariant-runner';
import { RuntimeTraceStore, RuntimeCausalityValidator } from '../tracing';
import { CausalityGraphStore, CausalityQueryAPI, LayerReconciler } from '../causality';
// NOTE: BUG-005 stress tests are now a standalone module and are not imported here
// to keep the invariant verification CLI lightweight and free of unresolved module coupling.
// Run stress tests via their own entry point or integration suite instead.

/**
 * Builds the Admin API schema straight from the Vendure config — the same
 * mechanism the Dashboard build uses (`@vendure/dashboard/vite` schema-generator).
 * No database connection is required.
 */
async function loadAdminSchema() {
  const { GraphQLTypesLoader } = await import('@nestjs/graphql');
  const {
    getConfig,
    getFinalVendureSchema,
    resetConfig,
    runPluginConfigurations,
    setConfig,
    VENDURE_ADMIN_API_TYPE_PATHS,
  } = await import('@vendure/core');
  const { buildSchema } = await import('graphql');
  // `vendure-config` must be loaded lazily (it registers plugin entities and
  // reads env at module scope) but cannot be reached through a relative ESM
  // specifier: `import('../../vendure-config')` fails `tsc` because the server
  // tsconfig is `module: nodenext` (relative ESM specifiers need an explicit
  // extension), while `import('../../vendure-config.js')` is unresolvable at
  // runtime under ts-node, where only the `.ts` source exists on disk. A CJS
  // require resolves in both worlds: ts-node maps the extensionless specifier
  // to the `.ts` source, and the compiled build maps it to `dist/vendure-config.js`.
  const { config } = createRequire(__filename)('../../vendure-config');

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

  return buildSchema(sdl);
}

async function main() {
  const runner = new InvariantRunner();

  const staticCheckers: Parameters<typeof runner.runAll>[0] = [
    new AdrChecker(),
    new RfcLifecycleChecker(),
    new StoryFlowChecker(),
    // INV-015: every Dashboard GraphQL document must validate against the Admin
    // schema. An unknown field rejects the whole operation, which the UI then
    // renders as an empty dataset — a silently broken ledger.
    new DashboardGraphqlContractChecker(process.cwd(), loadAdminSchema),
  ];

  console.log('=== Static Invariant Verification ===\n');
  const staticResults: CheckResult[] = await runner.runAll(staticCheckers);
  console.log(runner.report(staticResults));
  console.log('');

  const eventChainRunner = new RuntimeInvariantRunner(process.cwd());
  console.log('=== Event-Chain Inference Verification ===\n');
  const eventChainResults: CheckResult[] = await eventChainRunner.runRuntimeChecks();
  console.log(runner.report(eventChainResults));
  console.log('');

  console.log('=== Runtime Trace Causality Verification ===\n');
  const traceStore = new RuntimeTraceStore();
  const traceValidator = new RuntimeCausalityValidator(traceStore);
  const traceResults: CheckResult[] = await runner.runAll([traceValidator]);
  console.log(runner.report(traceResults));
  console.log('');

  console.log('=== Unified Causality Graph Verification ===\n');
  const graphStore = new CausalityGraphStore();
  const queryAPI = new CausalityQueryAPI(graphStore);
  const reconciler = new LayerReconciler(graphStore);

  const mismatches = reconciler.reconcile();
  const convergenceScore = reconciler.getConvergenceScore();

  const graphMismatches: CheckResult[] = [];
  for (const mismatch of mismatches) {
    graphMismatches.push({
      checker: 'unified-causality',
      name: 'layer-reconciliation',
      passed: mismatch.severity === 'info',
      severity: mismatch.severity,
      message: mismatch.message,
      details: mismatch.rule,
    });
  }

  console.log(runner.report(graphMismatches));
  console.log(`Convergence Score: ${convergenceScore}/100`);
  console.log('');

  const allResults = [...staticResults, ...eventChainResults, ...traceResults, ...graphMismatches];
  if (runner.hasErrors(allResults)) {
    process.exitCode = 1;
  }
}


main().catch((err) => {
  console.error('Invariant verification failed to run:', err);
  process.exitCode = 2;
});
