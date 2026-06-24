import { Building2Icon } from 'lucide-react';
import { defineDashboardExtension } from '@vendure/dashboard';

import { TenantProfileDetail } from './routes/tenant-profiles/TenantProfileDetail';
import { InstructorsList } from './routes/instructors/InstructorsList';
import { MediaResourcesList } from './routes/media/MediaResourcesList';
import { ACADEMY_NAV_ITEMS, AcademyHome } from './shared/academy-dashboard';

const academyPermissions: Record<string, string[]> = {
  'academy-overview': ['SuperAdmin', 'TenantProfileRead'],
  'tenant-profile': ['SuperAdmin', 'TenantProfileRead'],
  instructors: ['SuperAdmin', 'InstructorProfileRead'],
  'media-resources': ['SuperAdmin', 'MediaResourceRead'],
};

export default defineDashboardExtension({
  navSections: [
    {
      id: 'academy',
      title: 'Academy Console',
      icon: Building2Icon,
      placement: 'top',
      order: 90,
    },
  ],
  routes: [
    {
      path: '/academy',
      component: () => <AcademyHome />,
      navMenuItem: {
        sectionId: 'academy',
        title: 'Overview',
        icon: ACADEMY_NAV_ITEMS[0].icon,
        id: ACADEMY_NAV_ITEMS[0].id,
        url: ACADEMY_NAV_ITEMS[0].href,
        requiresPermission: academyPermissions[ACADEMY_NAV_ITEMS[0].id],
      },
    },
    {
      path: '/academy/tenant-profile',
      component: () => <TenantProfileDetail />,
      navMenuItem: {
        sectionId: 'academy',
        title: 'Tenant Profile',
        icon: ACADEMY_NAV_ITEMS[1].icon,
        id: ACADEMY_NAV_ITEMS[1].id,
        url: ACADEMY_NAV_ITEMS[1].href,
        requiresPermission: academyPermissions[ACADEMY_NAV_ITEMS[1].id],
      },
    },
    {
      path: '/academy/instructors',
      component: () => <InstructorsList />,
      navMenuItem: {
        sectionId: 'academy',
        title: 'Instructors',
        icon: ACADEMY_NAV_ITEMS[2].icon,
        id: ACADEMY_NAV_ITEMS[2].id,
        url: ACADEMY_NAV_ITEMS[2].href,
        requiresPermission: academyPermissions[ACADEMY_NAV_ITEMS[2].id],
      },
    },
    {
      path: '/academy/media',
      component: () => <MediaResourcesList />,
      navMenuItem: {
        sectionId: 'academy',
        title: 'Media Library',
        icon: ACADEMY_NAV_ITEMS[3].icon,
        id: ACADEMY_NAV_ITEMS[3].id,
        url: ACADEMY_NAV_ITEMS[3].href,
        requiresPermission: academyPermissions[ACADEMY_NAV_ITEMS[3].id],
      },
    },
  ],
});