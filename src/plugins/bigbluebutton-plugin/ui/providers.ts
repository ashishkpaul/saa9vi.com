import { addNavMenuSection } from "@vendure/admin-ui/core";

export default [
  addNavMenuSection(
    {
      id: "bbb-section",
      label: "BigBlueButton",
      items: [
        {
          id: "bbb-servers",
          label: "Servers",
          routerLink: ["/extensions/bbb/servers"],
          icon: "network-globe",
          requiresPermission: "BBBAdmin",
        },
        {
          id: "bbb-organizations",
          label: "Organizations",
          routerLink: ["/extensions/bbb/organizations"],
          icon: "building",
          requiresPermission: "BBBAdmin",
        },
        {
          id: "bbb-rooms",
          label: "Rooms",
          routerLink: ["/extensions/bbb/rooms"],
          icon: "file-settings",
          requiresPermission: "BBBAdmin",
        },
        {
          id: "bbb-meetings",
          label: "Meetings",
          routerLink: ["/extensions/bbb/meetings"],
          icon: "video-camera",
          requiresPermission: "BBBAdmin",
        },
        {
          id: "bbb-enrollments",
          label: "Enrollments",
          routerLink: ["/extensions/bbb/enrollments"],
          icon: "assign-user",
          requiresPermission: "BBBAdmin",
        },
        {
          id: "bbb-staff",
          label: "Staff",
          routerLink: ["/extensions/bbb/staff"],
          icon: "users",
          requiresPermission: "BBBAdmin",
        },
        {
          id: "bbb-plans",
          label: "Plans",
          routerLink: ["/extensions/bbb/plans"],
          icon: "certificate",
          requiresPermission: "BBBAdmin",
        },
      ],
    },
    "settings",
  ),
];
