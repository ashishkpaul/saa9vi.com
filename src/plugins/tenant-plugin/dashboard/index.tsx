import { Building2Icon, UserSquare2Icon, FileImageIcon } from 'lucide-react';
import { defineDashboardExtension } from '@vendure/dashboard';

import { TenantProfileDetail } from './routes/tenant-profiles/TenantProfileDetail';
import { InstructorsList } from './routes/instructors/InstructorsList';
import { MediaResourcesList } from './routes/media/MediaResourcesList';

export default defineDashboardExtension({
  navSections: [
    {
      id: 'tenant',
      title: 'Academy',
      icon: Building2Icon,
      placement: 'top',
      order: 90,
    },
  ],
  routes: [
    {
      path: '/academy/tenant-profile',
      component: () => <TenantProfileDetail />,
      navMenuItem: {
        sectionId: 'tenant',
        title: 'Tenant Profile',
        icon: Building2Icon,
        id: 'tenant-profile',
        url: '/academy/tenant-profile',
        requiresPermission: ['TenantProfileRead'],
      },
    },
    {
      path: '/academy/instructors',
      component: () => <InstructorsList />,
      navMenuItem: {
        sectionId: 'tenant',
        title: 'Instructors',
        icon: UserSquare2Icon,
        id: 'instructors',
        url: '/academy/instructors',
        requiresPermission: ['InstructorProfileRead'],
      },
    },
    {
      path: '/academy/media',
      component: () => <MediaResourcesList />,
      navMenuItem: {
        sectionId: 'tenant',
        title: 'Media',
        icon: FileImageIcon,
        id: 'media-resources',
        url: '/academy/media',
        requiresPermission: ['MediaResourceRead'],
      },
    },
  ],
});