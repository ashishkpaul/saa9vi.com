import { Injectable, Logger } from '@nestjs/common';

export type ToolCategory = 'AUTHORING' | 'INTERACTION' | 'ADMINISTRATION';

export interface CourseToolDefinition {
  /** Stable unique key (e.g. 'videoconference', 'agenda', 'users') */
  key: string;
  category: ToolCategory;
  label: string;
  /** Icon identifier for frontend rendering */
  icon: string;
  /** Fixed application route key — never tenant-configurable */
  routeKey: string;
  /** Default visibility for new courses */
  defaultVisibility: 'VISIBLE' | 'HIDDEN';
  /** Optional settings JSON validator */
  validateSettings?: (settings: unknown) => boolean;
}

const loggerCtx = 'CourseToolRegistry';

/**
 * C-24: Registry for course tools. Plugins contribute tool definitions
 * at startup. Duplicate keys are detected and rejected.
 *
 * Routes and component mappings live in trusted code only — tenant-provided
 * settings can never define arbitrary executable routes or components.
 */
@Injectable()
export class CourseToolRegistry {
  private readonly logger = new Logger(loggerCtx);
  private readonly tools = new Map<string, CourseToolDefinition>();

  /** Register a tool definition. Throws on duplicate key. */
  register(def: CourseToolDefinition): void {
    if (this.tools.has(def.key)) {
      throw new Error(`Duplicate course tool key: "${def.key}"`);
    }
    this.tools.set(def.key, def);
    this.logger.log(`Registered course tool: ${def.key} (${def.category})`);
  }

  /** Get a tool definition by key. Returns undefined for unknown keys. */
  get(key: string): CourseToolDefinition | undefined {
    return this.tools.get(key);
  }

  /** Check if a tool key is registered. */
  has(key: string): boolean {
    return this.tools.has(key);
  }

  /** List all registered tools, ordered by category then key. */
  list(): CourseToolDefinition[] {
    return Array.from(this.tools.values()).sort((a, b) =>
      a.category === b.category
        ? a.key.localeCompare(b.key)
        : a.category.localeCompare(b.category),
    );
  }

  /** Validate that all tool keys in a list are known and settings pass validation. */
  validateTools(tools: Array<{ toolKey: string; settings?: unknown }>): void {
    for (const t of tools) {
      const def = this.tools.get(t.toolKey);
      if (!def) {
        throw new Error(`Unknown course tool key: "${t.toolKey}"`);
      }
      if (def.validateSettings && t.settings != null) {
        if (!def.validateSettings(t.settings)) {
          throw new Error(`Invalid settings for tool "${t.toolKey}"`);
        }
      }
    }
  }
}
