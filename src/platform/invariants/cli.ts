import { InvariantRunner, AdrChecker, RfcLifecycleChecker, StoryFlowChecker, CheckResult } from './index';
import { RuntimeInvariantRunner } from './event-chain/runtime-invariant-runner';
import { RuntimeTraceStore, RuntimeCausalityValidator } from '../tracing';
import { CausalityGraphStore, CausalityQueryAPI, LayerReconciler } from '../causality';

async function main() {
  const runner = new InvariantRunner();

  const staticCheckers: Parameters<typeof runner.runAll>[0] = [
    new AdrChecker(),
    new RfcLifecycleChecker(),
    new StoryFlowChecker(),
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
