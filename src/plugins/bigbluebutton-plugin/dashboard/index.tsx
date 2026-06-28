import { MonitorIcon, ServerIcon, BuildingIcon, DoorOpenIcon, VideoIcon, UsersIcon, ClipboardIcon, CreditCardIcon, ClipboardCheckIcon, KeyIcon } from 'lucide-react';
import { defineDashboardExtension } from '@vendure/dashboard';

import { ServersList } from './routes/servers';
import { OrganizationsList } from './routes/organizations';
import { RoomsList } from './routes/rooms';
import { MeetingsList } from './routes/meetings';
import { MembersList } from './routes/members';
import { EnrollmentsList } from './routes/enrollments';
import { PlansList } from './routes/plans';
import { TrialRegistrationsList } from './routes/trials/TrialRegistrationsList';
import { EntitlementsList } from './routes/entitlements/EntitlementsList';
import { MembershipsList } from './routes/memberships/MembershipsList';

export default defineDashboardExtension({
    navSections: [
        {
            id: 'bbb',
            title: 'BigBlueButton',
            icon: MonitorIcon,
            placement: 'top',
            order: 100,
        },
    ],
    routes: [
        {
            path: '/bbb/servers',
            component: () => <ServersList />,
            navMenuItem: { sectionId: 'bbb', title: 'Servers', icon: ServerIcon, id: 'bbb-servers', url: '/bbb/servers', requiresPermission: ['BBBAdmin'] },
        },
        {
            path: '/bbb/organizations',
            component: () => <OrganizationsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Organizations', icon: BuildingIcon, id: 'bbb-organizations', url: '/bbb/organizations', requiresPermission: ['BBBAdmin'] },
        },
        {
            path: '/bbb/rooms',
            component: () => <RoomsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Rooms', icon: DoorOpenIcon, id: 'bbb-rooms', url: '/bbb/rooms', requiresPermission: ['BBBAdmin'] },
        },
        {
            path: '/bbb/meetings',
            component: () => <MeetingsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Meetings', icon: VideoIcon, id: 'bbb-meetings', url: '/bbb/meetings', requiresPermission: ['BBBAdmin'] },
        },
        {
            path: '/bbb/staff',
            component: () => <MembersList />,
            navMenuItem: { sectionId: 'bbb', title: 'Staff', icon: UsersIcon, id: 'bbb-staff', url: '/bbb/staff', requiresPermission: ['BBBAdmin'] },
        },
        {
            path: '/bbb/enrollments',
            component: () => <EnrollmentsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Enrollments', icon: ClipboardIcon, id: 'bbb-enrollments', url: '/bbb/enrollments', requiresPermission: ['BBBAdmin'] },
        },
        {
            path: '/bbb/plans',
            component: () => <PlansList />,
            navMenuItem: { sectionId: 'bbb', title: 'Capacity Grants', icon: CreditCardIcon, id: 'bbb-plans', url: '/bbb/plans', requiresPermission: ['BBBAdmin'] },
        },
        {
            path: '/bbb/trials',
            component: () => <TrialRegistrationsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Trial Registrations', icon: ClipboardCheckIcon, id: 'bbb-trials', url: '/bbb/trials', requiresPermission: ['BBBAdmin'] },
        },
        {
            path: '/bbb/entitlements',
            component: () => <EntitlementsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Entitlements', icon: KeyIcon, id: 'bbb-entitlements', url: '/bbb/entitlements', requiresPermission: ['BBBAdmin'] },
        },
        {
            path: '/bbb/memberships',
            component: () => <MembershipsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Memberships', icon: UsersIcon, id: 'bbb-memberships', url: '/bbb/memberships', requiresPermission: ['BBBAdmin'] },
        },
    ],
});
