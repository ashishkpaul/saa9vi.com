import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
} from "@angular/core";

import { FormsModule } from "@angular/forms";

import { CommonModule } from "@angular/common";

import {
  DataService,
  NotificationService,
  SharedModule,
} from "@vendure/admin-ui/core";

import { gql } from "graphql-tag";

import { first, merge, interval } from "rxjs";

import { switchMap, startWith, takeUntil } from "rxjs/operators";
import { BbbPaginatedListBase } from "./bbb-paginated-list-base";

const GET_BBB_MEETINGS = gql`
  query GetBbbMeetings($options: BbbMeetingListOptions) {
    bbbMeetings(options: $options) {
      items {
        id
        createdAt
        title
        state
        bbbMeetingId
        recordingEnabled
        provisionedAt
        completedAt
        failureReason
        retryCount
        organization {
          id
        }
      }
      totalItems
    }
  }
`;

const CREATE_BBB_MEETING = gql`
  mutation CreateBbbMeeting($input: CreateBbbMeetingInput!) {
    createBbbMeeting(input: $input) {
      id
      title
      state
    }
  }
`;

const RETRY_BBB_MEETING = gql`
  mutation RetryBbbMeeting($failedMeetingId: ID!) {
    retryBbbMeeting(failedMeetingId: $failedMeetingId) {
      id
      title
      state
    }
  }
`;

const UPDATE_BBB_MEETING = gql`
  mutation UpdateBbbMeeting($id: ID!, $input: UpdateBbbMeetingInput!) {
    updateBbbMeeting(id: $id, input: $input) {
      id
      title
      recordingEnabled
    }
  }
`;

const DELETE_BBB_MEETING = gql`
  mutation DeleteBbbMeeting($id: ID!) {
    deleteBbbMeeting(id: $id)
  }
`;

const END_BBB_MEETING = gql`
  mutation EndBbbMeeting($id: ID!) {
    endBbbMeeting(id: $id) {
      id
      state
    }
  }
`;

const STATE_BADGE: Record<string, "success" | "warning" | "error" | "default"> =
  {
    Pending: "warning",
    Provisioning: "warning",
    Active: "success",
    Completed: "default",
    Archived: "default",
    Failed: "error",
  };

@Component({
  selector: "bbb-meeting-list",

  standalone: true,

  imports: [SharedModule, FormsModule, CommonModule],

  changeDetection: ChangeDetectionStrategy.OnPush,

  template: `
    <vdr-page-block>
      <vdr-action-bar>
        <vdr-ab-left> </vdr-ab-left>

        <vdr-ab-right>
          <button class="btn btn-primary" (click)="showCreateForm = true">
            <clr-icon shape="plus"></clr-icon>
            Create Meeting
          </button>
        </vdr-ab-right>
      </vdr-action-bar>

      <!-- CREATE FORM -->

      <vdr-card
        *ngIf="showCreateForm"
        [title]="'New Meeting'"
        style="margin-top:12px"
      >
        <div class="form-field">
          <label>Organization ID</label>

          <input
            type="text"
            [(ngModel)]="newMeeting.organizationId"
            class="input"
            placeholder="Organization UUID"
          />
        </div>

        <div class="form-field">
          <label>Meeting Title</label>

          <input
            type="text"
            [(ngModel)]="newMeeting.title"
            class="input"
            placeholder="Weekly Training Session"
          />
        </div>

        <div class="form-field">
          <label class="checkbox-label">
            <input type="checkbox" [(ngModel)]="newMeeting.recordingEnabled" />

            Enable Recording
          </label>
        </div>

        <div class="form-actions">
          <button class="btn" (click)="cancelCreate()">Cancel</button>

          <button
            class="btn btn-primary"
            [disabled]="!isValidMeeting"
            (click)="createMeeting()"
          >
            Create & Provision
          </button>
        </div>

        <vdr-alert [type]="'info'" style="margin-top:12px">
          Meeting provisioning is async. State updates automatically every 15
          seconds.
        </vdr-alert>
      </vdr-card>

      <vdr-spinner *ngIf="loading"></vdr-spinner>

      <ng-container *ngIf="!loading">
        <vdr-data-table
          *ngIf="meetings.length; else emptyState"
          [items]="meetings"
          [itemsPerPage]="itemsPerPage"
          [currentPage]="currentPage"
          [totalItems]="totalItems"
          (pageChange)="setPage($event)"
          (itemsPerPageChange)="onItemsPerPageChange($event)"
        >
          <vdr-dt-column>Title</vdr-dt-column>
          <vdr-dt-column>State</vdr-dt-column>
          <vdr-dt-column>BBB Meeting ID</vdr-dt-column>
          <vdr-dt-column>Provisioned</vdr-dt-column>
          <vdr-dt-column>Recording</vdr-dt-column>
          <vdr-dt-column>Retry</vdr-dt-column>
          <vdr-dt-column>Actions</vdr-dt-column>

          <ng-template let-meeting="item">
            <td class="left">
              <!-- VIEW -->
              <strong *ngIf="editingId !== meeting.id">
                {{ meeting.title }}
              </strong>

              <!-- EDIT -->
              <input
                *ngIf="editingId === meeting.id"
                type="text"
                [(ngModel)]="editMeeting.title"
                class="input"
                placeholder="Meeting title"
              />

              <br />

              <small>
                {{ meeting.createdAt | date: "short" }}
              </small>
            </td>

            <td class="left">
              <vdr-chip [colorType]="getStateBadge(meeting.state)">
                {{ meeting.state }}
              </vdr-chip>
            </td>

            <td class="left">
              <code>
                {{ meeting.bbbMeetingId || "—" }}
              </code>
            </td>

            <td class="left">
              {{
                meeting.provisionedAt
                  ? (meeting.provisionedAt | date: "short")
                  : "Pending"
              }}
            </td>

            <td class="left">
              <vdr-chip
                [colorType]="meeting.recordingEnabled ? 'success' : 'warning'"
              >
                {{ meeting.recordingEnabled ? "Enabled" : "Disabled" }}
              </vdr-chip>
            </td>

            <td class="left">
              {{ meeting.retryCount }}
            </td>

            <td class="left">
              <!-- EDIT MODE -->
              <ng-container *ngIf="editingId === meeting.id">
                <button
                  class="btn btn-sm btn-success"
                  (click)="saveEdit(meeting)"
                >
                  Save
                </button>
                <button class="btn btn-sm" (click)="cancelEdit()">
                  Cancel
                </button>
              </ng-container>

              <!-- VIEW MODE -->
              <ng-container *ngIf="editingId !== meeting.id">
                <button
                  *ngIf="
                    meeting.state === 'Active' || meeting.state === 'Completed'
                  "
                  class="btn btn-sm"
                  (click)="startEdit(meeting)"
                  style="margin-right:4px"
                >
                  Edit
                </button>

                <button
                  *ngIf="meeting.state === 'Active'"
                  class="btn btn-sm btn-danger"
                  (click)="endMeeting(meeting.id)"
                  style="margin-right:4px"
                >
                  End
                </button>

                <button
                  *ngIf="meeting.state === 'Failed'"
                  class="btn btn-sm btn-warning"
                  (click)="retryMeeting(meeting)"
                  style="margin-right:4px"
                >
                  Retry
                </button>

                <button
                  class="btn btn-sm btn-danger"
                  (click)="deleteMeeting(meeting)"
                >
                  Delete
                </button>

                <span
                  *ngIf="meeting.state === 'Failed' && meeting.failureReason"
                  class="clr-subtext"
                  style="display:block;margin-top:4px"
                >
                  {{ meeting.failureReason }}
                </span>
              </ng-container>
            </td>
          </ng-template>
        </vdr-data-table>

        <ng-template #emptyState>
          <vdr-card>
            <div
              style="
                padding:24px;
                text-align:center;
                opacity:.7;
              "
            >
              No meetings found
            </div>
          </vdr-card>
        </ng-template>
      </ng-container>
    </vdr-page-block>
  `,

  styles: [
    `
      .form-field {
        margin-bottom: 14px;
      }

      .form-field label {
        display: block;
        font-size: 12px;
        font-weight: 500;
        margin-bottom: 4px;
        color: var(--color-text-200);
      }

      .input {
        width: 100%;
        padding: 6px 8px;
        border: 1px solid var(--color-component-border-200);
        border-radius: 3px;
        background: var(--color-form-input-bg);
        color: var(--color-text-100);
      }

      .form-actions {
        display: flex;
        gap: 8px;
        margin-top: 16px;
      }

      .checkbox-label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        cursor: pointer;
        color: var(--color-text-100);
      }
    `,
  ],
})
export class BbbMeetingListComponent extends BbbPaginatedListBase {
  meetings: any[] = [];

  showCreateForm = false;

  editingId: string | null = null;
  editMeeting: any = {};

  newMeeting = {
    organizationId: "",
    title: "",
    recordingEnabled: false,
  };

  constructor(
    private dataService: DataService,
    private notificationService: NotificationService,
    protected cdr: ChangeDetectorRef,
  ) {
    super();
  }

  ngOnInit(): void {
    merge(interval(15_000).pipe(startWith(0)), this.refresh$)
      .pipe(
        switchMap(() =>
          this.dataService
            .query(GET_BBB_MEETINGS, {
              options: {
                skip: (this.currentPage - 1) * this.itemsPerPage,
                take: this.itemsPerPage,
              },
            })
            .mapSingle((d: any) => ({
              items: d.bbbMeetings?.items ?? [],
              totalItems: d.bbbMeetings?.totalItems ?? 0,
            })),
        ),

        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (data: { items: any[]; totalItems: number }) => {
          this.meetings = data.items;
          this.totalItems = data.totalItems;
          this.clampPage();
          this.loading = false;
          this.cdr.markForCheck();
        },

        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to load meetings",
          );
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  load(): void {
    this.refresh$.next();
  }

  trackById(_: number, item: any): string {
    return item.id;
  }

  cancelCreate(): void {
    this.showCreateForm = false;
    this.newMeeting = {
      organizationId: "",
      title: "",
      recordingEnabled: false,
    };
  }

  get isValidMeeting(): boolean {
    return !!(this.newMeeting.title && this.newMeeting.organizationId);
  }

  getStateBadge(state: string): "success" | "warning" | "error" | "default" {
    return STATE_BADGE[state] ?? "default";
  }

  createMeeting(): void {
    if (!this.isValidMeeting) {
      this.notificationService.error("Title and Organization ID are required");
      return;
    }

    this.dataService
      .mutate(CREATE_BBB_MEETING, {
        input: this.newMeeting,
      })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success(
            "Meeting created. Provisioning in background...",
          );
          this.cancelCreate();
          this.refresh$.next();
        },

        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to create meeting",
          );
        },
      });
  }

  startEdit(meeting: any): void {
    this.editingId = meeting.id;
    this.editMeeting = {
      title: meeting.title,
    };
    this.cdr.markForCheck();
  }

  cancelEdit(): void {
    this.editingId = null;
    this.editMeeting = {};
    this.cdr.markForCheck();
  }

  saveEdit(meeting: any): void {
    const input: any = {};
    if (this.editMeeting.title !== meeting.title)
      input.title = this.editMeeting.title;

    if (Object.keys(input).length === 0) {
      this.cancelEdit();
      return;
    }

    this.dataService
      .mutate(UPDATE_BBB_MEETING, { id: meeting.id, input })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Meeting updated");
          this.cancelEdit();
          this.refresh$.next();
        },
        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to update meeting",
          );
        },
      });
  }

  endMeeting(id: string): void {
    this.dataService
      .mutate(END_BBB_MEETING, { id })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Meeting ended");
          this.refresh$.next();
        },

        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to end meeting",
          );
        },
      });
  }

  retryMeeting(failed: any): void {
    // Uses the dedicated retryBbbMeeting mutation which:
    // 1. Resets the room FSM (if the meeting has an associated room)
    // 2. Creates a new meeting with the same settings
    // This fixes the bug where the room was stuck in "Failed" state with
    // retryCount >= maxAutoRetries, causing requestProvisioning to return
    // shouldEnqueue=false for storefront users.
    this.dataService
      .mutate(RETRY_BBB_MEETING, {
        failedMeetingId: failed.id,
      })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Retry meeting created");
          this.refresh$.next();
        },
        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to retry meeting",
          );
        },
      });
  }

  deleteMeeting(meeting: any): void {
    if (!confirm(`Delete meeting "${meeting.title}"? This cannot be undone.`))
      return;

    this.dataService
      .mutate(DELETE_BBB_MEETING, { id: meeting.id })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Meeting deleted");
          this.refresh$.next();
        },
        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to delete meeting",
          );
        },
      });
  }
}
