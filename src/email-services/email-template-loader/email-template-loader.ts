import { Injectable } from '@nestjs/common';
import { Injector, RequestContext } from '@vendure/core';
import { TemplateLoader, LoadTemplateInput } from '@vendure/email-plugin';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Channel-aware dynamic template loader for multi-tenant / multi-vendor architectures.
 * 
 * Lookup Order:
 * 1. Channel-specific template: `<baseDir>/<channel.token>/<type>/<fileName>`
 * 2. Default directory fallback: `<baseDir>/default/<type>/<fileName>`
 * 3. Base directory root fallback: `<baseDir>/<type>/<fileName>`
 * 4. Partials fallback: `<baseDir>/partials/<fileName>` or `<baseDir>/<channel.token>/partials/<fileName>`
 */
@Injectable()
export class ChannelBasedTemplateLoader implements TemplateLoader {
  private baseTemplatePath: string;

  constructor(customBaseDir?: string) {
    this.baseTemplatePath = customBaseDir
      ? path.resolve(customBaseDir)
      : path.resolve(process.cwd(), 'static/email/templates');
  }

  async loadTemplate(
    injector: Injector,
    ctx: RequestContext,
    input: LoadTemplateInput
  ): Promise<string> {
    const { type, templateName } = input;
    const channelToken = ctx?.channel?.token || 'default';

    const fileName = templateName.endsWith('.hbs') ? templateName : `${templateName}.hbs`;

    // Candidate search paths in priority order
    const candidatePaths: string[] = [];

    if (type === 'partials') {
      // Handle partials resolution (e.g., {{> header }} or {{> footer }})
      candidatePaths.push(
        path.join(this.baseTemplatePath, channelToken, 'partials', fileName),
        path.join(this.baseTemplatePath, 'default', 'partials', fileName),
        path.join(this.baseTemplatePath, 'partials', fileName),
        path.join(this.baseTemplatePath, channelToken, fileName),
        path.join(this.baseTemplatePath, fileName)
      );
    } else {
      // Standard email template resolution (e.g. order-confirmation/body.hbs)
      candidatePaths.push(
        path.join(this.baseTemplatePath, channelToken, type, fileName),
        path.join(this.baseTemplatePath, 'default', type, fileName),
        path.join(this.baseTemplatePath, type, fileName)
      );
    }

    for (const candidatePath of candidatePaths) {
      try {
        const content = await fs.readFile(candidatePath, 'utf8');
        return content;
      } catch (error: any) {
        // Continue searching next candidate if file does not exist
        if (error.code !== 'ENOENT') {
          console.warn(`[ChannelBasedTemplateLoader] Error reading template at ${candidatePath}:`, error.message);
        }
      }
    }

    const searchedLocations = candidatePaths.join('\n  - ');
    const errorMessage = `[ChannelBasedTemplateLoader] Failed to load template "${type}/${fileName}" for channel "${channelToken}". Checked paths:\n  - ${searchedLocations}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
}
