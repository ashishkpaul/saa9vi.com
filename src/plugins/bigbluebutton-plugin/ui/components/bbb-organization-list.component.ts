import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
} from "@angular/core";

import { FormsModule } from "@angular/forms";

import {
  DataService,
  NotificationService,
  SharedModule,
} from "@vendure/admin-ui/core";

import { gql } from "graphql-tag";

import { first, merge, interval } from "rxjs";
import { switchMap, startWith, takeUntil } from "rxjs/operators";
import { BbbPaginatedListBase } from "./bbb-paginated-list-base";

const GET_BBB_ORGANIZATIONS = gql`
  query GetBbbOrganizations($options: BbbOrganizationListOptions) {
    bbbOrganizations(options: $options) {
      items {
        id
        channelId
        slug
        name
        concurrentMeetingLimit
        maxParticipantsPerMeeting
        recordingEnabled
        suspended
      }
      totalItems
    }
  }
`;

const CREATE_BBB_ORGANIZATION = gql`
  mutation CreateBbbOrganization($input: CreateBbbOrganizationInput!) {
    createBbbOrganization(input: $input) {
      id
      slug
      name
    }
  }
`;

const UPDATE_BBB_ORGANIZATION = gql`
  mutation UpdateBbbOrganization(
    $id: ID!
    $input: UpdateBbbOrganizationInput!
  ) {
    updateBbbOrganization(id: $id, input: $input) {
      id
      slug
      name
      concurrentMeetingLimit
      maxParticipantsPerMeeting
      recordingEnabled
      suspended
    }
  }
`;

const DELETE_BBB_ORGANIZATION = gql`
  mutation DeleteBbbOrganization($id: ID!) {
    deleteBbbOrganization(id: $id)
  }
`;

@Component({
  selector: "bbb-organization-list",

  standalone: true,

  imports: [SharedModule, FormsModule],

  changeDetection: ChangeDetectionStrategy.OnPush,

  template: `
    <vdr-page-block>
      <vdr-action-bar>
        <vdr-ab-left> </vdr-ab-left>

        <vdr-ab-right>
          <button class="btn btn-primary" (click)="showCreateForm = true">
            <clr-icon shape="plus"></clr-icon>
            Add Organization
          </button>
        </vdr-ab-right>
      </vdr-action-bar>

      <!-- CREATE FORM -->

      <vdr-card
        *ngIf="showCreateForm"
        title="New Organization"
        style="margin-top:12px"
      >
        <div class="form-field">
          <label>Channel ID</label>

          <input
            type="text"
            [(ngModel)]="newOrg.channelId"
            class="input"
            placeholder="Vendure Channel ID"
          />

          <small class="clr-subtext">
            Must match an existing Vendure Channel
          </small>
        </div>

        <div class="form-field">
          <label>Slug</label>

          <input
            type="text"
            [(ngModel)]="newOrg.slug"
            class="input"
            placeholder="acme-academy"
          />
        </div>

        <div class="form-field">
          <label>Display Name</label>

          <input
            type="text"
            [(ngModel)]="newOrg.name"
            class="input"
            placeholder="Acme Academy"
          />
        </div>

        <div class="form-field">
          <label>Concurrent Meeting Limit</label>

          <input
            type="number"
            [(ngModel)]="newOrg.concurrentMeetingLimit"
            class="input"
            min="1"
            max="100"
          />
        </div>

        <div class="form-field">
          <label>Max Participants per Meeting</label>

          <input
            type="number"
            [(ngModel)]="newOrg.maxParticipantsPerMeeting"
            class="input"
            min="1"
            max="500"
          />
        </div>

        <div class="form-actions">
          <button class="btn" (click)="cancelCreate()">Cancel</button>

          <button
            class="btn btn-primary"
            [disabled]="!isValid"
            (click)="createOrg()"
          >
            Create
          </button>
        </div>
      </vdr-card>

      <vdr-spinner *ngIf="loading"></vdr-spinner>

      <ng-container *ngIf="!loading">
        <vdr-data-table
          *ngIf="organizations.length; else emptyState"
          [items]="organizations"
          [itemsPerPage]="itemsPerPage"
          [currentPage]="currentPage"
          [totalItems]="totalItems"
          (pageChange)="setPage($event)"
          (itemsPerPageChange)="onItemsPerPageChange($event)"
        >
          <vdr-dt-column>Organization</vdr-dt-column>
          <vdr-dt-column>Limits</vdr-dt-column>
          <vdr-dt-column>Recording</vdr-dt-column>
          <vdr-dt-column>Status</vdr-dt-column>
          <vdr-dt-column>Channel</vdr-dt-column>
          <vdr-dt-column>Actions</vdr-dt-column>

          <ng-template let-org="item">
            <td class="left">
              <!-- VIEW -->
              <strong *ngIf="editingId !== org.id">
                {{ org.name }}
              </strong>

              <!-- EDIT -->
              <input
                *ngIf="editingId === org.id"
                type="text"
                [(ngModel)]="editOrg.name"
                class="input"
                placeholder="Organization name"
              />

              <br />

              <code class="small" *ngIf="editingId !== org.id">
                {{ org.slug }}
              </code>
            </td>

            <td class="left">
              <span *ngIf="editingId !== org.id">
                {{ org.concurrentMeetingLimit }} concurrent
                <br />
                {{ org.maxParticipantsPerMeeting }} participants
              </span>

              <div *ngIf="editingId === org.id">
                <input
                  type="number"
                  [(ngModel)]="editOrg.concurrentMeetingLimit"
                  class="input"
                  min="1"
                  style="width:80px;margin-bottom:4px"
                  placeholder="Concurrent"
                />
                <input
                  type="number"
                  [(ngModel)]="editOrg.maxParticipantsPerMeeting"
                  class="input"
                  min="1"
                  style="width:80px"
                  placeholder="Participants"
                />
              </div>
            </td>

            <td class="left">
              <vdr-chip
                [colorType]="org.recordingEnabled ? 'success' : 'warning'"
              >
                {{ org.recordingEnabled ? "Enabled" : "Disabled" }}
              </vdr-chip>
            </td>

            <td class="left">
              <vdr-chip [colorType]="org.suspended ? 'error' : 'success'">
                {{ org.suspended ? "Suspended" : "Active" }}
              </vdr-chip>
            </td>

            <td class="left">
              <code>
                {{ org.channelId }}
              </code>
            </td>

            <td class="left">
              <!-- EDIT MODE -->
              <ng-container *ngIf="editingId === org.id">
                <button class="btn btn-sm btn-success" (click)="saveEdit(org)">
                  Save
                </button>
                <button class="btn btn-sm" (click)="cancelEdit()">
                  Cancel
                </button>
              </ng-container>

              <!-- VIEW MODE -->
              <ng-container *ngIf="editingId !== org.id">
                <button
                  class="btn btn-sm"
                  (click)="startEdit(org)"
                  style="margin-right:4px"
                >
                  Edit
                </button>
                <button class="btn btn-sm btn-danger" (click)="deleteOrg(org)">
                  Delete
                </button>
              </ng-container>
            </td>
          </ng-template>
        </vdr-data-table>

        <ng-template #emptyState>
          <vdr-card>
            <div style="padding:24px;text-align:center;opacity:.7">
              No organizations found
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
    `,
  ],
})
export class BbbOrganizationListComponent extends BbbPaginatedListBase {
  organizations: any[] = [];

  showCreateForm = false;

  editingId: string | null = null;
  editOrg: any = {};

  newOrg = {
    channelId: "",
    slug: "",
    name: "",
    concurrentMeetingLimit: 5,
    maxParticipantsPerMeeting: 30,
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
            .query(GET_BBB_ORGANIZATIONS, {
              options: {
                skip: (this.currentPage - 1) * this.itemsPerPage,
                take: this.itemsPerPage,
              },
            })
            .mapSingle((d: any) => ({
              items: d.bbbOrganizations?.items ?? [],
              totalItems: d.bbbOrganizations?.totalItems ?? 0,
            })),
        ),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (data: { items: any[]; totalItems: number }) => {
          this.organizations = data.items;
          this.totalItems = data.totalItems;
          this.clampPage();
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to load organizations",
          );
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  load(): void {
    this.refresh$.next();
  }

  get isValid(): boolean {
    return !!(this.newOrg.channelId && this.newOrg.slug && this.newOrg.name);
  }

  cancelCreate(): void {
    this.showCreateForm = false;
    this.newOrg = {
      channelId: "",
      slug: "",
      name: "",
      concurrentMeetingLimit: 5,
      maxParticipantsPerMeeting: 30,
    };
  }

  createOrg(): void {
    if (!this.isValid) {
      this.notificationService.error("Channel ID, slug, and name are required");
      return;
    }

    this.dataService
      .mutate(CREATE_BBB_ORGANIZATION, {
        input: this.newOrg,
      })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Organization created");
          this.cancelCreate();
          this.refresh$.next();
        },
        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to create organization",
          );
        },
      });
  }

  startEdit(org: any): void {
    this.editingId = org.id;
    this.editOrg = {
      name: org.name,
      concurrentMeetingLimit: org.concurrentMeetingLimit,
      maxParticipantsPerMeeting: org.maxParticipantsPerMeeting,
    };
    this.cdr.markForCheck();
  }

  cancelEdit(): void {
    this.editingId = null;
    this.editOrg = {};
    this.cdr.markForCheck();
  }

  saveEdit(org: any): void {
    const input: any = {};
    if (this.editOrg.name !== org.name) input.name = this.editOrg.name;
    if (this.editOrg.concurrentMeetingLimit !== org.concurrentMeetingLimit)
      input.concurrentMeetingLimit = this.editOrg.concurrentMeetingLimit;
    if (
      this.editOrg.maxParticipantsPerMeeting !== org.maxParticipantsPerMeeting
    )
      input.maxParticipantsPerMeeting = this.editOrg.maxParticipantsPerMeeting;

    if (Object.keys(input).length === 0) {
      this.cancelEdit();
      return;
    }

    this.dataService
      .mutate(UPDATE_BBB_ORGANIZATION, { id: org.id, input })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Organization updated");
          this.cancelEdit();
          this.refresh$.next();
        },
        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to update organization",
          );
        },
      });
  }

  deleteOrg(org: any): void {
    if (!confirm(`Delete organization "${org.name}"? This cannot be undone.`))
      return;

    this.dataService
      .mutate(DELETE_BBB_ORGANIZATION, { id: org.id })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Organization deleted");
          this.refresh$.next();
        },
        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to delete organization",
          );
        },
      });
  }
}
