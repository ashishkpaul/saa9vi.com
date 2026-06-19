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
import { EMPTY, first, merge, interval, BehaviorSubject } from "rxjs";
import { switchMap, startWith, takeUntil } from "rxjs/operators";
import { BbbPaginatedListBase } from "./bbb-paginated-list-base";

const GET_ORGS = gql`
  query GetBbbOrgsForRoomPicker {
    bbbOrganizations {
      items {
        id
        name
        slug
      }
      totalItems
    }
  }
`;

const GET_BBB_ROOMS = gql`
  query GetBbbRooms($organizationId: ID!, $options: BbbRoomListOptions) {
    bbbRooms(organizationId: $organizationId, options: $options) {
      items {
        id
        createdAt
        updatedAt
        name
        description
        slug
        state
        currentMeetingId
        retryCount
        recordingEnabled
        maxParticipants
        lastProvisionRequestedAt
      }
      totalItems
    }
  }
`;

const CREATE_BBB_ROOM = gql`
  mutation CreateBbbRoom($input: CreateBbbRoomInput!) {
    createBbbRoom(input: $input) {
      id
      name
      state
    }
  }
`;

const UPDATE_BBB_ROOM = gql`
  mutation UpdateBbbRoom($id: ID!, $input: UpdateBbbRoomInput!) {
    updateBbbRoom(id: $id, input: $input) {
      id
      name
      recordingEnabled
      description
    }
  }
`;

const DELETE_BBB_ROOM = gql`
  mutation DeleteBbbRoom($id: ID!) {
    deleteBbbRoom(id: $id)
  }
`;

const RESET_BBB_ROOM = gql`
  mutation ResetBbbRoom($id: ID!) {
    resetBbbRoom(id: $id) {
      id
      state
    }
  }
`;

const STATE_BADGE: Record<string, "success" | "warning" | "error" | "default"> =
  {
    Idle: "default",
    Provisioning: "warning",
    Active: "success",
    Failed: "error",
  };

@Component({
  selector: "bbb-room-list",
  standalone: true,
  imports: [SharedModule, FormsModule, CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vdr-page-block>
      <vdr-action-bar>
        <vdr-ab-left> </vdr-ab-left>
      </vdr-action-bar>

      <!-- Organization Picker -->
      <vdr-card title="Organization" style="margin-top: 12px">
        <div class="form-field">
          <select
            class="input"
            [(ngModel)]="selectedOrganizationId"
            (ngModelChange)="onOrganizationChange()"
          >
            <option value="">-- Select organization --</option>
            <option *ngFor="let org of organizations" [value]="org.id">
              {{ org.name }} ({{ org.slug }})
            </option>
          </select>
        </div>
      </vdr-card>

      <!-- Create Room Form -->
      <vdr-card
        *ngIf="selectedOrganizationId"
        title="Create Room"
        style="margin-top: 12px"
      >
        <div class="grid-2">
          <div class="form-field">
            <label>Room Name</label>
            <input
              type="text"
              class="input"
              [(ngModel)]="newRoom.name"
              placeholder="Training Room A"
            />
          </div>
          <div class="form-field">
            <label>Slug (optional, URL-friendly)</label>
            <input
              type="text"
              class="input"
              [(ngModel)]="newRoom.slug"
              placeholder="training-room-a"
            />
          </div>
        </div>
        <div class="form-field">
          <label>Description</label>
          <input
            type="text"
            class="input"
            [(ngModel)]="newRoom.description"
            placeholder="Weekly team training sessions"
          />
        </div>
        <div class="form-field">
          <label class="checkbox-label">
            <input type="checkbox" [(ngModel)]="newRoom.recordingEnabled" />
            Enable Recording
          </label>
        </div>
        <div class="form-actions">
          <button
            class="btn btn-primary"
            [disabled]="!newRoom.name"
            (click)="createRoom()"
          >
            <clr-icon shape="plus"></clr-icon>
            Create Room
          </button>
        </div>
      </vdr-card>

      <vdr-spinner *ngIf="loading"></vdr-spinner>

      <ng-container *ngIf="!loading">
        <vdr-data-table
          *ngIf="rooms.length; else emptyState"
          [items]="rooms"
          [itemsPerPage]="itemsPerPage"
          [currentPage]="currentPage"
          [totalItems]="totalItems"
          (pageChange)="setPage($event)"
          (itemsPerPageChange)="onItemsPerPageChange($event)"
        >
          <vdr-dt-column>Name</vdr-dt-column>
          <vdr-dt-column>State</vdr-dt-column>
          <vdr-dt-column>Recording</vdr-dt-column>
          <vdr-dt-column>Current Session</vdr-dt-column>
          <vdr-dt-column>Retries</vdr-dt-column>
          <vdr-dt-column>Actions</vdr-dt-column>

          <ng-template let-room="item">
            <td class="left">
              <strong>{{ room.name }}</strong>
              <br />
              <small class="clr-subtext">
                {{ room.description || "—" }}
              </small>
              <br />
              <small class="clr-subtext"> Slug: {{ room.slug || "—" }} </small>
            </td>
            <td class="left">
              <vdr-chip [colorType]="getStateBadge(room.state)">
                {{
                  room.state === "Idle"
                    ? "Ready"
                    : room.state === "Provisioning"
                      ? "Starting"
                      : room.state === "Active"
                        ? "Live"
                        : room.state === "Failed"
                          ? "Unavailable"
                          : room.state
                }}
              </vdr-chip>
            </td>
            <td class="left">
              <vdr-chip
                [colorType]="room.recordingEnabled ? 'success' : 'warning'"
              >
                {{ room.recordingEnabled ? "On" : "Off" }}
              </vdr-chip>
            </td>
            <td class="left">
              <code>{{ room.currentMeetingId || "—" }}</code>
            </td>
            <td class="left">{{ room.retryCount }}</td>
            <td class="left">
              <button
                *ngIf="room.state === 'Failed'"
                class="btn btn-sm btn-warning"
                (click)="resetRoom(room.id)"
                style="margin-right: 4px"
              >
                Reset
              </button>
              <button class="btn btn-sm btn-danger" (click)="deleteRoom(room)">
                Delete
              </button>
            </td>
          </ng-template>
        </vdr-data-table>

        <ng-template #emptyState>
          <vdr-card *ngIf="selectedOrganizationId" style="margin-top: 16px">
            <div style="padding: 24px; text-align: center; opacity: 0.7">
              No rooms yet. Create one above.
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
      .grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
    `,
  ],
})
export class BbbRoomListComponent extends BbbPaginatedListBase {
  organizations: any[] = [];
  rooms: any[] = [];
  selectedOrganizationId = "";

  newRoom = {
    name: "",
    slug: "",
    description: "",
    recordingEnabled: false,
  };

  /** Emits when the selected organization changes to restart the polling stream */
  private readonly orgChange$ = new BehaviorSubject<string>("");

  constructor(
    private dataService: DataService,
    private notificationService: NotificationService,
    protected cdr: ChangeDetectorRef,
  ) {
    super();
  }

  ngOnInit(): void {
    this.loadOrganizations();

    // Unified polling stream: triggers on org change, refresh, or 15s interval
    this.orgChange$
      .pipe(
        switchMap((orgId) => {
          if (!orgId) {
            this.rooms = [];
            this.totalItems = 0;
            this.loading = false;
            this.cdr.markForCheck();
            return EMPTY;
          }
          this.loading = true;
          this.cdr.markForCheck();
          // Merge manual refresh triggers and polling interval
          return merge(
            this.refresh$.pipe(startWith(undefined)),
            interval(15_000),
          ).pipe(
            switchMap(() =>
              this.dataService
                .query(GET_BBB_ROOMS, {
                  organizationId: orgId,
                  options: {
                    skip: (this.currentPage - 1) * this.itemsPerPage,
                    take: this.itemsPerPage,
                  },
                })
                .mapSingle((d: any) => ({
                  items: d.bbbRooms?.items ?? [],
                  totalItems: d.bbbRooms?.totalItems ?? 0,
                })),
            ),
          );
        }),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (data: { items: any[]; totalItems: number }) => {
          this.rooms = data.items;
          this.totalItems = data.totalItems;
          this.clampPage();
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          this.loading = false;
          this.notificationService.error(
            err?.message ?? "Failed to load rooms",
          );
          this.cdr.markForCheck();
        },
      });
  }

  load(): void {
    if (this.selectedOrganizationId) {
      this.refresh$.next();
    }
  }

  getStateBadge(state: string): "success" | "warning" | "error" | "default" {
    return STATE_BADGE[state] ?? "default";
  }

  onOrganizationChange(): void {
    this.rooms = [];
    this.currentPage = 1;
    this.totalItems = 0;
    this.orgChange$.next(this.selectedOrganizationId);
  }

  private loadOrganizations(): void {
    this.loading = true;
    this.dataService
      .query(GET_ORGS)
      .mapSingle((d: any) => d.bbbOrganizations?.items ?? [])
      .pipe(first())
      .subscribe({
        next: (orgs: any[]) => {
          this.organizations = orgs;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          this.loading = false;
          this.notificationService.error(
            err?.message ?? "Failed to load organizations",
          );
          this.cdr.markForCheck();
        },
      });
  }

  createRoom(): void {
    if (!this.newRoom.name) return;

    this.dataService
      .mutate(CREATE_BBB_ROOM, {
        input: {
          organizationId: this.selectedOrganizationId,
          name: this.newRoom.name,
          slug: this.newRoom.slug || undefined,
          description: this.newRoom.description || undefined,
          recordingEnabled: this.newRoom.recordingEnabled,
        },
      })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Room created");
          this.newRoom = {
            name: "",
            slug: "",
            description: "",
            recordingEnabled: false,
          };
          this.refresh$.next();
        },
        error: (err: any) => {
          this.notificationService.error(
            err?.message ?? "Failed to create room",
          );
        },
      });
  }

  resetRoom(id: string): void {
    this.dataService
      .mutate(RESET_BBB_ROOM, { id })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Room reset to Idle");
          this.refresh$.next();
        },
        error: (err: any) => {
          this.notificationService.error(
            err?.message ?? "Failed to reset room",
          );
        },
      });
  }

  deleteRoom(room: any): void {
    if (!confirm(`Delete room "${room.name}"? This cannot be undone.`)) return;
    this.dataService
      .mutate(DELETE_BBB_ROOM, { id: room.id })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Room deleted");
          this.refresh$.next();
        },
        error: (err: any) => {
          this.notificationService.error(
            err?.message ?? "Failed to delete room",
          );
        },
      });
  }
}
