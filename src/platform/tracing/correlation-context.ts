export class CorrelationContext {
  private static current: string | null = null;
  private static parent: string | null = null;
  private static stack: string[] = [];

  static set(correlationId: string): void {
    if (!this.current) {
      this.current = correlationId;
    } else {
      this.stack.push(this.current);
      this.parent = this.current;
      this.current = correlationId;
    }
  }

  static get(): string | null {
    return this.current;
  }

  static getParent(): string | null {
    return this.parent;
  }

  static pop(): void {
    const previous = this.stack.pop();
    if (previous) {
      this.current = previous;
      this.parent = this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
    } else {
      this.current = null;
      this.parent = null;
    }
  }

  static reset(): void {
    this.current = null;
    this.parent = null;
    this.stack = [];
  }

  static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
}
