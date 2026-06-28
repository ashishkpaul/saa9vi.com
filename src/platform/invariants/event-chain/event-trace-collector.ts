import * as path from 'path';
import { findFiles, readFileContent } from '../runner';

export interface EventEmission {
  eventName: string;
  file: string;
  line: number;
  triggeredActions: string[];
}

export interface EventChain {
  trigger: string;
  steps: string[];
}

export class EventTraceCollector {
  private eventEmissions: EventEmission[] = [];
  private eventChains: EventChain[] = [];

  async scanProject(srcDir: string): Promise<void> {
    const files = findFiles(
      [
        'src/plugins/**/services/*.ts',
        'src/plugins/**/listeners/*.ts',
        'src/plugins/**/jobs/*.ts',
      ],
      srcDir
    );

    for (const file of files) {
      await this.scanFile(file);
    }

    this.buildEventChains();
  }

  private async scanFile(filePath: string): Promise<void> {
    const content = readFileContent(filePath);
    const lines = content.split('\n');

    // Match event emissions: new SomeEvent(, this.eventBus.publish(, this.eventBus.emit(
    const eventEmitRegex = /new\s+(\w+Event)\s*\(|\.publish\s*\(\s*new\s+(\w+Event)|\.emit\s*\(\s*new\s+(\w+Event)/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;

      while ((match = eventEmitRegex.exec(line)) !== null) {
        const eventName = match[1] || match[2] || match[3];
        if (eventName) {
          const triggeredActions = this.inferTriggeredActions(lines, i);
          this.eventEmissions.push({
            eventName,
            file: path.basename(filePath),
            line: i + 1,
            triggeredActions,
          });
        }
      }
    }
  }

  private inferTriggeredActions(lines: string[], startLine: number): string[] {
    const actions: string[] = [];
    const lookahead = Math.min(startLine + 30, lines.length);

    for (let i = startLine; i < lookahead; i++) {
      const line = lines[i];

      if (/createInvoice|SubscriptionInvoice/.test(line)) {
        actions.push('SubscriptionInvoice');
      }
      if (/RecurringCapacityGrant|createGrant/.test(line)) {
        actions.push('RecurringCapacityGrant');
      }
      if (/orderService\.create|OrderLine/.test(line)) {
        actions.push('Order');
      }
      if (/BbbUsageLedger|ledger\.write/.test(line)) {
        actions.push('BbbUsageLedger');
      }
      if (/entitlementService\.create|createEntitlement/.test(line)) {
        actions.push('Entitlement');
      }
      if (/BbbWebhookEvent|webhookEventRepo\.save/.test(line)) {
        actions.push('BbbWebhookEvent');
      }
      if (/jobQueue\.add|enqueue/.test(line)) {
        actions.push('BullMQJob');
      }
    }

    return actions;
  }

  private buildEventChains(): void {
    const chainMap = new Map<string, string[]>();

    for (const emission of this.eventEmissions) {
      const key = emission.eventName;
      const existing = chainMap.get(key) || [];
      for (const action of emission.triggeredActions) {
        if (!existing.includes(action)) {
          existing.push(action);
        }
      }
      chainMap.set(key, existing);
    }

    for (const [trigger, steps] of chainMap) {
      this.eventChains.push({ trigger, steps });
    }
  }

  getEmissions(): EventEmission[] {
    return this.eventEmissions;
  }

  getChains(): EventChain[] {
    return this.eventChains;
  }

  hasEvent(eventName: string): boolean {
    return this.eventEmissions.some(e => e.eventName === eventName);
  }

  hasChain(trigger: string, requiredSteps: string[]): boolean {
    const chain = this.eventChains.find(c => c.trigger === trigger);
    if (!chain) return false;

    return requiredSteps.every(step => chain.steps.includes(step));
  }
}
