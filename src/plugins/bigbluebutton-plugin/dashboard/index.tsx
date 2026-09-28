import { MonitorIcon, ServerIcon, BuildingIcon, DoorOpenIcon, VideoIcon, UsersIcon, ClipboardIcon, CreditCardIcon, ClipboardCheckIcon, KeyIcon, CalendarIcon, GraduationCapIcon, ShieldCheckIcon } from 'lucide-react';
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
import { SessionsList } from './routes/sessions/SessionsList';
import { sessionDetail } from './routes/sessions/SessionDetail';
// NOTE: MembershipsList is deliberately NOT routed. It duplicates Staff
// (`/bbb/staff` over BbbOrganizationMember) with the older
// BbbOrganizationMembership model and has no UI entry point. The file stays on
// disk only because two dashboard ratchet specs still list it as a baseline
// entry — remove those entries before deleting the file.

/**
 * Four role-oriented groups instead of ten flat items.
 *
 * URLs, nav ids and `requiresPermission` values are unchanged, so bookmarks,
 * deep links and the sessionDetail route keep working. Section titles are
 * prefixed "BBB · " on purpose: Vendure's sidebar already carries generic
 * top-level names (Catalog, Customers, Settings), so a bare "Platform" or
 * "Classes" would be ambiguous next to them. A section whose items are all
 * hidden by permissions disappears automatically.
 */
export default defineDashboardExtension({
    navSections: [
        {
            id: 'bbb-platform',
            title: 'BBB · Platform',
            icon: ShieldCheckIcon,
            placement: 'top',
            order: 100,
        },
        {
            id: 'bbb-classes',
            title: 'BBB · Classes',
            icon: MonitorIcon,
            placement: 'top',
            order: 101,
        },
        {
            id: 'bbb-people',
            title: 'BBB · People & access',
            icon: GraduationCapIcon,
            placement: 'top',
            order: 102,
        },
        {
            id: 'bbb-capacity',
            title: 'BBB · Capacity',
            icon: CreditCardIcon,
            placement: 'top',
            order: 103,
        },
    ],
    routes: [
        // BBB · Platform — infrastructure & tenants
        {
            path: '/bbb/servers',
            component: () => <ServersList />,
            navMenuItem: { sectionId: 'bbb-platform', title: 'Servers', icon: ServerIcon, id: 'bbb-servers', url: '/bbb/servers', requiresPermission: ['BBBAdmin', 'BBBPlatformInfrastructure'] },
        },
        {
            path: '/bbb/organizations',
            component: () => <OrganizationsList />,
            navMenuItem: { sectionId: 'bbb-platform', title: 'Organizations', icon: BuildingIcon, id: 'bbb-organizations', url: '/bbb/organizations', requiresPermission: ['BBBAdmin', 'BBBManageOrganizations'] },
        },
        // BBB · Classes — rooms and scheduled sessions first, meeting log last
        {
            path: '/bbb/rooms',
            component: () => <RoomsList />,
            navMenuItem: { sectionId: 'bbb-classes', title: 'Rooms', icon: DoorOpenIcon, id: 'bbb-rooms', url: '/bbb/rooms', requiresPermission: ['BBBAdmin', 'BBBManageRooms'] },
        },
        {
            path: '/bbb/sessions',
            component: () => <SessionsList />,
            navMenuItem: { sectionId: 'bbb-classes', title: 'Sessions', icon: CalendarIcon, id: 'bbb-sessions', url: '/bbb/sessions', requiresPermission: ['BBBAdmin', 'BBBManageSessions'] },
        },
        {
            path: '/bbb/meetings',
            component: () => <MeetingsList />,
            navMenuItem: { sectionId: 'bbb-classes', title: 'Meeting log', icon: VideoIcon, id: 'bbb-meetings', url: '/bbb/meetings', requiresPermission: ['BBBAdmin', 'BBBManageMeetings'] },
        },
        // BBB · People & access — who may attend, and with what rights
        {
            path: '/bbb/staff',
            component: () => <MembersList />,
            navMenuItem: { sectionId: 'bbb-people', title: 'Staff', icon: UsersIcon, id: 'bbb-staff', url: '/bbb/staff', requiresPermission: ['BBBAdmin', 'BBBManageMembers'] },
        },
        {
            path: '/bbb/enrollments',
            component: () => <EnrollmentsList />,
            navMenuItem: { sectionId: 'bbb-people', title: 'Enrollments', icon: ClipboardIcon, id: 'bbb-enrollments', url: '/bbb/enrollments', requiresPermission: ['BBBAdmin', 'BBBManageRooms'] },
        },
        {
            path: '/bbb/trials',
            component: () => <TrialRegistrationsList />,
            navMenuItem: { sectionId: 'bbb-people', title: 'Trial Registrations', icon: ClipboardCheckIcon, id: 'bbb-trials', url: '/bbb/trials', requiresPermission: ['BBBAdmin', 'BBBManageSessions'] },
        },
        {
            path: '/bbb/entitlements',
            component: () => <EntitlementsList />,
            navMenuItem: { sectionId: 'bbb-people', title: 'Entitlements', icon: KeyIcon, id: 'bbb-entitlements', url: '/bbb/entitlements', requiresPermission: ['BBBAdmin', 'BBBManageEntitlements'] },
        },
        // BBB · Capacity — minute budgets & grants
        {
            path: '/bbb/plans',
            component: () => <PlansList />,
            navMenuItem: { sectionId: 'bbb-capacity', title: 'Capacity', icon: CreditCardIcon, id: 'bbb-plans', url: '/bbb/plans', requiresPermission: ['BBBAdmin', 'BBBManageOrganizations'] },
        },
        // Detail route: no navMenuItem (opened from the Sessions table).
        sessionDetail,
    ],
});
