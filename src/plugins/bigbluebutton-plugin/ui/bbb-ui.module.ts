import { NgModule } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { SharedModule } from "@vendure/admin-ui/core";
import { BbbServerListComponent } from "./components/bbb-server-list.component";
import { BbbOrganizationListComponent } from "./components/bbb-organization-list.component";
import { BbbRoomListComponent } from "./components/bbb-room-list.component";
import { BbbMeetingListComponent } from "./components/bbb-meeting-list.component";
import { BbbMemberListComponent } from "./components/bbb-member-list.component";
import { BbbEnrollmentListComponent } from "./components/bbb-enrollment-list.component";
import { BbbPlanListComponent } from "./components/bbb-plan-list.component";

@NgModule({
  imports: [
    SharedModule,
    FormsModule,
    BbbServerListComponent,
    BbbOrganizationListComponent,
    BbbRoomListComponent,
    BbbMeetingListComponent,
    BbbMemberListComponent,
    BbbEnrollmentListComponent,
    BbbPlanListComponent,
  ],
  exports: [
    BbbServerListComponent,
    BbbOrganizationListComponent,
    BbbRoomListComponent,
    BbbMeetingListComponent,
    BbbMemberListComponent,
    BbbEnrollmentListComponent,
    BbbPlanListComponent,
  ],
})
export class BbbUiExtensionModule {}
