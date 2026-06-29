import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationState {
  current: string | null;
  parent: string | null;
  stack: string[];
}

const storage = new AsyncLocalStorage<CorrelationState>();

export class CorrelationContext {
  private static getState(): CorrelationState {
    return storage.getStore() ?? { current: null, parent: null, stack: [] };
  }

  static run<T>(fn: () => T): T {
    return storage.run({ current: null, parent: null, stack: [] }, fn);
  }

  static set(correlationId: string): void {
    const state = this.getState();
    if (!state.current) {
      state.current = correlationId;
    } else {
      state.stack.push(state.current);
      state.parent = state.current;
      state.current = correlationId;
    }
  }

  static get(): string | null {
    return this.getState().current;
  }

  static getParent(): string | null {
    return this.getState().parent;
  }

  static pop(): void {
    const state = this.getState();
    const previous = state.stack.pop();
    if (previous) {
      state.current = previous;
      state.parent = state.stack.length > 0 ? state.stack[state.stack.length - 1] : null;
    } else {
      state.current = null;
      state.parent = null;
    }
  }

  static reset(): void {
    const state = this.getState();
    state.current = null;
    state.parent = null;
    state.stack = [];
  }

  static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
}
