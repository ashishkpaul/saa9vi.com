import {
    MonitorIcon,
    CloudIcon,
    DoorOpenIcon,
    VideoIcon,
    UsersIcon,
    CreditCardIcon,
    BuildingIcon,
    ServerIcon,
    ClipboardCheckIcon,
} from 'lucide-react';
import { defineDashboardExtension } from '@vendure/dashboard';

import { ServersList } from './routes/servers';
import { OrganizationsList } from './routes/organizations';
import { RoomsList, roomDetail } from './routes/rooms';
import { MeetingsHistoryList, LiveMeetingsList } from './routes/meetings';
import { PeopleList } from './routes/people';
import { BillingOverview } from './routes/billing';
import { MembersList } from './routes/members';
import { EnrollmentsList } from './routes/enrollments';
import { EntitlementsList } from './routes/entitlements/EntitlementsList';
import { PlansList } from './routes/plans';
import { TrialRegistrationsList } from './routes/trials/TrialRegistrationsList';
import { SessionsList } from './routes/sessions/SessionsList';
import { sessionDetail } from './routes/sessions/SessionDetail';

// ─── S5 (Phase 6 lean) — two-section IA ─────────────────────────────────────
//
// Tenant section (`bbb`) — Rooms, Meetings, People, Billing: what a tenant admin
// actually uses. Tenant documents carry no plumbing (A11: no grantId, serverId,
// currentMeetingId, retryCount or provisioning states) and no org picker — the
// organization is resolved server-side from the active channel (INV-001), so
// the channel switcher is the only org selector.
//
// Platform section (`bbb-platform`) — Organizations, Servers, Capacity (the old
// PlansList, renamed: "Capacity Grants" is A11 vocabulary), Live Meetings (the
// old technical MeetingsList, which keeps its org picker because platform
// operators browse across tenants) and Trial Registrations (§7 Q3: platform-only).
// Every item is gated ['BBBAdmin','BBBPlatformInfrastructure'] — A15: retarget
// the gate, never edit the tenant role.
//
// The remaining technical screens stay *routed* but lose their tenant nav
// entries: /bbb/entitlements (reachable from People — A19), /bbb/enrollments,
// /bbb/staff, /bbb/sessions and /bbb/sessions/$id. MembershipsList stays
// unrouted, as it was before this change.

const PLATFORM_PERMISSIONS = ['BBBAdmin', 'BBBPlatformInfrastructure'];

export default defineDashboardExtension({
    navSections: [
        {
            id: 'bbb',
            title: 'BigBlueButton',
            icon: MonitorIcon,
            placement: 'top',
            order: 100,
        },
        {
            id: 'bbb-platform',
            title: 'BBB Platform',
            icon: CloudIcon,
            placement: 'top',
            order: 101,
        },
    ],
    routes: [
        // ─── Tenant ──────────────────────────────────────────────────────────
        {
            path: '/bbb/rooms',
            component: () => <RoomsList />,
            navMenuItem: {
                sectionId: 'bbb',
                title: 'Rooms',
                icon: DoorOpenIcon,
                id: 'bbb-rooms',
                url: '/bbb/rooms',
                order: 1,
                requiresPermission: ['BBBAdmin', 'BBBManageRooms'],
            },
        },
        roomDetail,
        {
            // Tenant *history*: billed classes from bbbMeteredMeetings. The old
            // technical screen moved to Platform › Live Meetings.
            path: '/bbb/meetings',
            component: () => <MeetingsHistoryList />,
            navMenuItem: {
                sectionId: 'bbb',
                title: 'Meetings',
                icon: VideoIcon,
                id: 'bbb-meetings',
                url: '/bbb/meetings',
                order: 2,
                requiresPermission: ['BBBAdmin', 'BBBManageMeetings'],
            },
        },
        {
            path: '/bbb/people',
            component: () => <PeopleList />,
            navMenuItem: {
                sectionId: 'bbb',
                title: 'People',
                icon: UsersIcon,
                id: 'bbb-people',
                url: '/bbb/people',
                order: 3,
                requiresPermission: ['BBBAdmin', 'BBBManageMembers'],
            },
        },
        {
            // D3: tenant billing reads reuse BBBManageMeetings.
            path: '/bbb/billing',
            component: () => <BillingOverview />,
            navMenuItem: {
                sectionId: 'bbb',
                title: 'Billing',
                icon: CreditCardIcon,
                id: 'bbb-billing',
                url: '/bbb/billing',
                order: 4,
                requiresPermission: ['BBBAdmin', 'BBBManageMeetings'],
            },
        },

        // ─── Platform (A15: platform tier only) ──────────────────────────────
        {
            path: '/bbb/organizations',
            component: () => <OrganizationsList />,
            navMenuItem: {
                sectionId: 'bbb-platform',
                title: 'Organizations',
                icon: BuildingIcon,
                id: 'bbb-organizations',
                url: '/bbb/organizations',
                order: 1,
                requiresPermission: PLATFORM_PERMISSIONS,
            },
        },
        {
            path: '/bbb/servers',
            component: () => <ServersList />,
            navMenuItem: {
                sectionId: 'bbb-platform',
                title: 'Servers',
                icon: ServerIcon,
                id: 'bbb-servers',
                url: '/bbb/servers',
                order: 2,
                requiresPermission: PLATFORM_PERMISSIONS,
            },
        },
        {
            // Old PlansList. Minting capacity grants is platform-only (H2), so the
            // tenant must never see this entry.
            path: '/bbb/plans',
            component: () => <PlansList />,
            navMenuItem: {
                sectionId: 'bbb-platform',
                title: 'Capacity',
                icon: CreditCardIcon,
                id: 'bbb-plans',
                url: '/bbb/plans',
                order: 3,
                requiresPermission: PLATFORM_PERMISSIONS,
            },
        },
        {
            // The old technical MeetingsList: org picker, bbbMeetingId, retry
            // counts, provisioning states. Platform operators browse across
            // tenants, so the org filter stays here and only here.
            path: '/bbb/live-meetings',
            component: () => <LiveMeetingsList />,
            navMenuItem: {
                sectionId: 'bbb-platform',
                title: 'Live Meetings',
                icon: VideoIcon,
                id: 'bbb-live-meetings',
                url: '/bbb/live-meetings',
                order: 4,
                requiresPermission: PLATFORM_PERMISSIONS,
            },
        },
        {
            // §7 Q3 (2026-09-30): platform-only. The route stays reachable by URL
            // for whoever holds the permission, but it is not a tenant nav item.
            path: '/bbb/trials',
            component: () => <TrialRegistrationsList />,
            navMenuItem: {
                sectionId: 'bbb-platform',
                title: 'Trial Registrations',
                icon: ClipboardCheckIcon,
                id: 'bbb-trials',
                url: '/bbb/trials',
                order: 5,
                requiresPermission: PLATFORM_PERMISSIONS,
            },
        },

        // ─── Routed, no nav entry ────────────────────────────────────────────
        // Legacy technical screens. Kept mounted so deep links and bookmarks keep
        // working; their destinations are now reachable through People (A19) or
        // the platform section. Their permission gates are unchanged (A15).
        {
            path: '/bbb/staff',
            component: () => <MembersList />,
        },
        {
            path: '/bbb/enrollments',
            component: () => <EnrollmentsList />,
        },
        {
            path: '/bbb/entitlements',
            component: () => <EntitlementsList />,
        },
        {
            path: '/bbb/sessions',
            component: () => <SessionsList />,
        },
        sessionDetail,
    ],
});
