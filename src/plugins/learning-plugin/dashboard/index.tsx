import { BookOpenIcon } from 'lucide-react';
import { defineDashboardExtension } from '@vendure/dashboard';

import { CoursesList } from './routes/courses/CoursesList';
import { courseDetail } from './routes/courses/CourseDetail';

export default defineDashboardExtension({
  navSections: [
    {
      id: 'learning',
      title: 'Courses',
      icon: BookOpenIcon,
      placement: 'top',
      order: 80,
    },
  ],
  routes: [
    {
      path: '/learning',
      component: () => <CoursesList />,
      navMenuItem: {
        sectionId: 'learning',
        title: 'Courses',
        icon: BookOpenIcon,
        id: 'courses',
        url: '/learning',
        requiresPermission: ['SuperAdmin', 'ReadCourseManage'],
      },
    },
    courseDetail,
  ],
});
