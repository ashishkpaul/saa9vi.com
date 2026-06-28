import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

export type CheckSeverity = 'error' | 'warning' | 'info';

export interface CheckResult {
  checker: string;
  name: string;
  passed: boolean;
  severity: CheckSeverity;
  message: string;
  details?: string;
}

export interface Checker {
  name: string;
  check: () => CheckResult | Promise<CheckResult>;
}

export class InvariantRunner {
  private results: CheckResult[] = [];

  async register(checker: Checker): Promise<void> {
    const result = await checker.check();
    this.results.push(result);
  }

  async runAll(checkers: Checker[]): Promise<CheckResult[]> {
    this.results = [];
    for (const checker of checkers) {
      try {
        await this.register(checker);
      } catch (err) {
        this.results.push({
          checker: checker.name,
          name: 'runner',
          passed: false,
          severity: 'error',
          message: `Checker crashed: ${(err as Error).message}`,
        });
      }
    }
    return this.results;
  }

  report(results: CheckResult[] = this.results): string {
    const lines: string[] = [];
    lines.push('=== Invariant Verification Report ===');
    lines.push('');

    let errors = 0;
    let warnings = 0;
    let passes = 0;

    for (const r of results) {
      const icon = r.passed ? '✅' : r.severity === 'error' ? '❌' : '⚠️';
      lines.push(`${icon} [${r.checker}] ${r.name}`);
      lines.push(`   ${r.message}`);
      if (r.details) {
        lines.push(`   ${r.details}`);
      }
      lines.push('');

      if (!r.passed) {
        if (r.severity === 'error') errors++;
        else warnings++;
      } else {
        passes++;
      }
    }

    lines.push(`--- Summary: ${passes} passed, ${warnings} warnings, ${errors} errors ---`);
    return lines.join('\n');
  }

  hasErrors(results: CheckResult[] = this.results): boolean {
    return results.some(r => !r.passed && r.severity === 'error');
  }
}

export function findFiles(patterns: string[], cwd: string): string[] {
  const files = new Set<string>();
  for (const pattern of patterns) {
    const matches = glob.sync(pattern, { cwd, absolute: true });
    for (const m of matches) files.add(m);
  }
  return Array.from(files);
}

export function readFileContent(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}
