import { InvariantRunner, Checker, CheckResult } from '../runner';
import { EventTraceCollector } from './event-trace-collector';
import { EventCausalityValidator } from './event-causality-validator';

export class RuntimeInvariantRunner extends InvariantRunner {
  private collector: EventTraceCollector;
  private projectRoot: string;

  constructor(projectRoot: string) {
    super();
    this.projectRoot = projectRoot;
    this.collector = new EventTraceCollector();
  }

  async runRuntimeChecks(): Promise<CheckResult[]> {
    await this.collector.scanProject(this.projectRoot);

    const runtimeCheckers: Checker[] = [
      new EventCausalityValidator(this.collector),
    ];

    return this.runAll(runtimeCheckers);
  }

  getCollector(): EventTraceCollector {
    return this.collector;
  }
}
