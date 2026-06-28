import { Injectable } from "@nestjs/common";
import { EventBus, VendureEvent } from "@vendure/core";
import { LoadOrchestrator, LoadProfile } from "../engine/load-orchestrator";
import { LifecycleSimulator } from "../../../platform/stress-test/lifecycle-simulator";

@Injectable()
export class LoadSimulationService {
  constructor(
    private eventBus: EventBus,
    private orchestrator: LoadOrchestrator,
  ) {}

  async run(profileName: string): Promise<{ id: string; profile: string; status: string }> {
    const id = `${profileName}-${Date.now()}`;
    this.eventBus.publish(new LoadTestStartedEvent(id, profileName));

    const lifecycles = LifecycleSimulator.getAllLifecycles();
    const lifecycleNames = Object.keys(lifecycles);
    const firstLifecycle = lifecycles[lifecycleNames[0]];

    const profile: LoadProfile = {
      name: profileName as LoadProfile["name"],
      concurrency: 1,
      durationMs: 1000,
    };

    const result = await this.orchestrator.run(firstLifecycle, profile);

    return {
      id,
      profile: profileName,
      status: `completed: ${result.totalRequests} requests, ${result.errorRate * 100}% error rate`,
    };
  }
}

export class LoadTestStartedEvent extends VendureEvent {
  constructor(public testId: string, public profile: string) {
    super();
  }
}
