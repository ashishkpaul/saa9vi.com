import { Injectable, OnModuleInit } from '@nestjs/common';
import { CourseToolRegistry, CourseToolDefinition } from './course-tool-registry';

/**
 * N-07 (L10 fix): registers LearningPlugin's built-in course tools so
 * new courses created without a template get the default tool set.
 *
 * Tools: description, users, agenda, announcements (videoconference is
 * contributed by the BBB plugin via BbbVideoconferenceToolContributor).
 */
@Injectable()
export class LearningToolContributor implements OnModuleInit {
  private static readonly TOOLS: CourseToolDefinition[] = [
    {
      key: 'description',
      category: 'AUTHORING',
      label: 'Course Description',
      icon: 'document',
      routeKey: 'description',
      defaultVisibility: 'VISIBLE',
    },
    {
      key: 'users',
      category: 'ADMINISTRATION',
      label: 'Users',
      icon: 'people',
      routeKey: 'users',
      defaultVisibility: 'VISIBLE',
    },
    {
      key: 'agenda',
      category: 'INTERACTION',
      label: 'Agenda',
      icon: 'calendar',
      routeKey: 'agenda',
      defaultVisibility: 'VISIBLE',
    },
    {
      key: 'announcements',
      category: 'INTERACTION',
      label: 'Announcements',
      icon: 'megaphone',
      routeKey: 'announcements',
      defaultVisibility: 'VISIBLE',
    },
  ];

  constructor(private readonly toolRegistry: CourseToolRegistry) {}

  onModuleInit() {
    for (const tool of LearningToolContributor.TOOLS) {
      this.toolRegistry.register(tool);
    }
  }
}
