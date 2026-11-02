import { Injectable, OnModuleInit } from '@nestjs/common';
import { CourseToolRegistry, CourseToolDefinition } from '../../learning-plugin/services/course-tool-registry';

/**
 * C-27: BBB contributes the `videoconference` tool to the LearningPlugin
 * tool registry. The definition lives in trusted code — tenant settings
 * cannot define arbitrary routes or components.
 *
 * The tool itself is INTERACTION category. Visibility is presentation only;
 * actual room/join authorization is enforced by BbbRoomAccessService (INV-027).
 */
@Injectable()
export class BbbVideoconferenceToolContributor implements OnModuleInit {
  private static readonly TOOL: CourseToolDefinition = {
    key: 'videoconference',
    category: 'INTERACTION',
    label: 'Video Conference',
    icon: 'video',
    routeKey: 'videoconference',
    defaultVisibility: 'VISIBLE',
  };

  constructor(private readonly toolRegistry: CourseToolRegistry) {}

  onModuleInit() {
    this.toolRegistry.register(BbbVideoconferenceToolContributor.TOOL);
  }
}
