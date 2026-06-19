import { registerRouteComponent } from "@vendure/admin-ui/core";

import { BbbServerListComponent } from "./components/bbb-server-list.component";
import { BbbOrganizationListComponent } from "./components/bbb-organization-list.component";
import { BbbRoomListComponent } from "./components/bbb-room-list.component";
import { BbbMeetingListComponent } from "./components/bbb-meeting-list.component";
import { BbbMemberListComponent } from "./components/bbb-member-list.component";
import { BbbEnrollmentListComponent } from "./components/bbb-enrollment-list.component";
import { BbbPlanListComponent } from "./components/bbb-plan-list.component";

export default [
  registerRouteComponent({
    path: "servers",
    component: BbbServerListComponent,
    title: "BBB Servers",
    breadcrumb: "Servers",
  }),
  registerRouteComponent({
    path: "organizations",
    component: BbbOrganizationListComponent,
    title: "BBB Organizations",
    breadcrumb: "Organizations",
  }),
  registerRouteComponent({
    path: "rooms",
    component: BbbRoomListComponent,
    title: "BBB Rooms",
    breadcrumb: "Rooms",
  }),
  registerRouteComponent({
    path: "meetings",
    component: BbbMeetingListComponent,
    title: "BBB Meetings",
    breadcrumb: "Meetings",
  }),
  registerRouteComponent({
    path: "staff",
    component: BbbMemberListComponent,
    title: "Organization Staff",
    breadcrumb: "Staff",
  }),
  registerRouteComponent({
    path: "enrollments",
    component: BbbEnrollmentListComponent,
    title: "Enrollments",
    breadcrumb: "Enrollments",
  }),
  registerRouteComponent({
    path: "plans",
    component: BbbPlanListComponent,
    title: "BBB Plans",
    breadcrumb: "Plans",
  }),
];
