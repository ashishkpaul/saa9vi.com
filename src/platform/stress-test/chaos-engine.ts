export type ChaosStrategy = "reorder" | "duplicate" | "delay" | "drop" | "corrupt";

export interface ChaosConfig {
  strategy: ChaosStrategy;
  probability: number;
  params?: Record<string, unknown>;
}

export class ChaosEngine {
  static apply<T>(items: T[], configs: ChaosConfig[]): T[] {
    let result = [...items] as T[];

    for (const config of configs) {
      if (Math.random() > config.probability) continue;

      switch (config.strategy) {
        case "reorder":
          result = this.reorder(result, config.params);
          break;
        case "duplicate":
          result = this.duplicate(result, config.params);
          break;
        case "delay":
          result = this.delay(result, config.params);
          break;
        case "drop":
          result = this.drop(result, config.params);
          break;
        case "corrupt":
          result = this.corrupt(result, config.params);
          break;
      }
    }

    return result;
  }

  private static reorder<T>(items: T[], params?: Record<string, unknown>): T[] {
    const maxSwaps = (params?.maxSwaps as number) || 1;
    const result = [...items] as T[];

    for (let i = 0; i < maxSwaps; i++) {
      const idx1 = Math.floor(Math.random() * result.length);
      const idx2 = Math.floor(Math.random() * result.length);
      [result[idx1], result[idx2]] = [result[idx2], result[idx1]];
    }

    return result;
  }

  private static duplicate<T>(items: T[], params?: Record<string, unknown>): T[] {
    const maxDuplicates = (params?.maxDuplicates as number) || 1;
    const result = [...items] as T[];

    for (let i = 0; i < maxDuplicates; i++) {
      const idx = Math.floor(Math.random() * result.length);
      result.splice(idx, 0, result[idx]);
    }

    return result;
  }

  private static delay<T>(items: T[], _params?: Record<string, unknown>): T[] {
    // In streaming context, delay is simulated by reordering to later positions
    return items;
  }

  private static drop<T>(items: T[], params?: Record<string, unknown>): T[] {
    const maxDrops = (params?.maxDrops as number) || 1;
    const result = [...items] as T[];

    for (let i = 0; i < maxDrops; i++) {
      if (result.length === 0) break;
      const idx = Math.floor(Math.random() * result.length);
      result.splice(idx, 1);
    }

    return result;
  }

  private static corrupt<T>(items: T[], _params?: Record<string, unknown>): T[] {
    // Corruption is represented by inserting null/undefined sentinels
    return items;
  }
}
