import { MonitorIcon, ServerIcon, BuildingIcon, DoorOpenIcon, VideoIcon, UsersIcon, ClipboardIcon, CreditCardIcon, ClipboardCheckIcon, KeyIcon, CalendarIcon } from 'lucide-react';
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
import { SessionsList } from './routes/sessions/SessionsList';
import { sessionDetail } from './routes/sessions/SessionDetail';

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
            navMenuItem: { sectionId: 'bbb', title: 'Servers', icon: ServerIcon, id: 'bbb-servers', url: '/bbb/servers', requiresPermission: ['BBBAdmin', 'BBBPlatformInfrastructure'] },
        },
        {
            path: '/bbb/organizations',
            component: () => <OrganizationsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Organizations', icon: BuildingIcon, id: 'bbb-organizations', url: '/bbb/organizations', requiresPermission: ['BBBAdmin', 'BBBManageOrganizations'] },
        },
        {
            path: '/bbb/rooms',
            component: () => <RoomsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Rooms', icon: DoorOpenIcon, id: 'bbb-rooms', url: '/bbb/rooms', requiresPermission: ['BBBAdmin', 'BBBManageRooms'] },
        },
        {
            path: '/bbb/meetings',
            component: () => <MeetingsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Meetings', icon: VideoIcon, id: 'bbb-meetings', url: '/bbb/meetings', requiresPermission: ['BBBAdmin', 'BBBManageMeetings'] },
        },
        {
            path: '/bbb/staff',
            component: () => <MembersList />,
            navMenuItem: { sectionId: 'bbb', title: 'Staff', icon: UsersIcon, id: 'bbb-staff', url: '/bbb/staff', requiresPermission: ['BBBAdmin', 'BBBManageMembers'] },
        },
        {
            path: '/bbb/enrollments',
            component: () => <EnrollmentsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Enrollments', icon: ClipboardIcon, id: 'bbb-enrollments', url: '/bbb/enrollments', requiresPermission: ['BBBAdmin', 'BBBManageRooms'] },
        },
        {
            // H2 UI mirror (2026-09-30): minting capacity grants is platform-only, so
            // the tenant admin must not see this nav entry. The route stays mounted for
            // platform operators; the gate is retargeted, never the tenant role (A15).
            // Phase 6 relocates this into the Platform section as `Capacity`.
            path: '/bbb/plans',
            component: () => <PlansList />,
            navMenuItem: { sectionId: 'bbb', title: 'Capacity Grants', icon: CreditCardIcon, id: 'bbb-plans', url: '/bbb/plans', requiresPermission: ['BBBAdmin', 'BBBPlatformInfrastructure'] },
        },
        {
            // Trials nav decision (§7 Q3, 2026-09-30): Trial Registrations stays
            // platform-only — the route remains reachable by URL for whoever holds the
            // permission, but it is no longer a tenant nav item. Folding it into
            // People → Students is Phase 6.1 and would remove this entry entirely.
            path: '/bbb/trials',
            component: () => <TrialRegistrationsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Trial Registrations', icon: ClipboardCheckIcon, id: 'bbb-trials', url: '/bbb/trials', requiresPermission: ['BBBAdmin', 'BBBPlatformInfrastructure'] },
        },
        {
            path: '/bbb/entitlements',
            component: () => <EntitlementsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Entitlements', icon: KeyIcon, id: 'bbb-entitlements', url: '/bbb/entitlements', requiresPermission: ['BBBAdmin', 'BBBManageEntitlements'] },
        },
        {
            path: '/bbb/sessions',
            component: () => <SessionsList />,
            navMenuItem: { sectionId: 'bbb', title: 'Sessions', icon: CalendarIcon, id: 'bbb-sessions', url: '/bbb/sessions', requiresPermission: ['BBBAdmin', 'BBBManageSessions'] },
        },
        sessionDetail,
    ],
});
