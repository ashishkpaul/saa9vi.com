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

const GET_BBB_SERVERS = gql`
  query GetBbbServers($options: BbbServerListOptions) {
    bbbServers(options: $options) {
      items {
        id
        name
        apiUrl
        enabled
        healthy
        currentLoad
        maxLoad
        lastHealthCheckAt
      }
      totalItems
    }
  }
`;

const CREATE_BBB_SERVER = gql`
  mutation CreateBbbServer($input: CreateBbbServerInput!) {
    createBbbServer(input: $input) {
      id
      name
      apiUrl
      enabled
      healthy
    }
  }
`;

const UPDATE_BBB_SERVER = gql`
  mutation UpdateBbbServer($id: ID!, $input: UpdateBbbServerInput!) {
    updateBbbServer(id: $id, input: $input) {
      id
      name
      apiUrl
      enabled
      maxLoad
    }
  }
`;

const DELETE_BBB_SERVER = gql`
  mutation DeleteBbbServer($id: ID!) {
    deleteBbbServer(id: $id)
  }
`;

@Component({
  selector: "bbb-server-list",
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
            Add Server
          </button>
        </vdr-ab-right>
      </vdr-action-bar>

      <!-- CREATE FORM -->

      <vdr-card
        *ngIf="showCreateForm"
        [title]="'Add BBB Server'"
        style="margin-top: 12px"
      >
        <div class="form-field">
          <label>Name</label>

          <input
            type="text"
            [(ngModel)]="newServer.name"
            class="input"
            placeholder="Primary BBB Server"
          />
        </div>

        <div class="form-field">
          <label>API URL</label>

          <input
            type="url"
            [(ngModel)]="newServer.apiUrl"
            class="input"
            placeholder="https://bbb.example.com/bigbluebutton"
          />
        </div>

        <div class="form-field">
          <label>API Secret</label>

          <input
            type="password"
            [(ngModel)]="newServer.apiSecret"
            class="input"
          />

          <small class="clr-subtext">
            Stored AES-256-GCM encrypted at rest. Never exposed through the API.
          </small>
        </div>

        <div class="form-actions">
          <button class="btn" (click)="cancelCreate()">Cancel</button>

          <button
            class="btn btn-primary"
            [disabled]="!isValidServer"
            (click)="createServer()"
          >
            Add Server
          </button>
        </div>
      </vdr-card>

      <vdr-spinner *ngIf="loading"></vdr-spinner>

      <ng-container *ngIf="!loading">
        <vdr-data-table
          *ngIf="servers.length; else emptyState"
          [items]="servers"
          [itemsPerPage]="itemsPerPage"
          [currentPage]="currentPage"
          [totalItems]="totalItems"
          (pageChange)="setPage($event)"
          (itemsPerPageChange)="onItemsPerPageChange($event)"
        >
          <vdr-dt-column>Name</vdr-dt-column>
          <vdr-dt-column>API URL</vdr-dt-column>
          <vdr-dt-column>Status</vdr-dt-column>
          <vdr-dt-column>Load</vdr-dt-column>
          <vdr-dt-column>Enabled</vdr-dt-column>
          <vdr-dt-column>Actions</vdr-dt-column>

          <ng-template let-server="item">
            <td class="left">
              <!-- VIEW -->
              <strong *ngIf="editingId !== server.id">{{ server.name }}</strong>

              <!-- EDIT -->
              <input
                *ngIf="editingId === server.id"
                type="text"
                [(ngModel)]="editServer.name"
                class="input"
                placeholder="Server name"
              />
            </td>

            <td class="left">
              <code *ngIf="editingId !== server.id">{{ server.apiUrl }}</code>

              <input
                *ngIf="editingId === server.id"
                type="url"
                [(ngModel)]="editServer.apiUrl"
                class="input"
                placeholder="https://..."
              />
            </td>

            <td class="left">
              <vdr-chip [colorType]="server.healthy ? 'success' : 'error'">
                {{ server.healthy ? "Healthy" : "Unhealthy" }}
              </vdr-chip>
            </td>

            <td class="left">
              <span *ngIf="editingId !== server.id"
                >{{ server.currentLoad }} / {{ server.maxLoad }}</span
              >

              <input
                *ngIf="editingId === server.id"
                type="number"
                [(ngModel)]="editServer.maxLoad"
                class="input"
                min="1"
                style="width:80px"
              />
            </td>

            <td class="left">
              <vdr-chip [colorType]="server.enabled ? 'success' : 'warning'">
                {{ server.enabled ? "Enabled" : "Disabled" }}
              </vdr-chip>
            </td>

            <td class="left">
              <!-- EDIT MODE -->
              <ng-container *ngIf="editingId === server.id">
                <button
                  class="btn btn-sm btn-success"
                  (click)="saveEdit(server)"
                >
                  Save
                </button>
                <button class="btn btn-sm" (click)="cancelEdit()">
                  Cancel
                </button>
              </ng-container>

              <!-- VIEW MODE -->
              <ng-container *ngIf="editingId !== server.id">
                <button
                  class="btn btn-sm"
                  (click)="startEdit(server)"
                  style="margin-right:4px"
                >
                  Edit
                </button>

                <button
                  class="btn btn-sm"
                  [class.btn-warning]="server.enabled"
                  [class.btn-secondary]="!server.enabled"
                  (click)="toggleEnabled(server)"
                  style="margin-right:4px"
                >
                  {{ server.enabled ? "Disable" : "Enable" }}
                </button>

                <button
                  class="btn btn-sm btn-danger"
                  (click)="deleteServer(server)"
                >
                  Delete
                </button>
              </ng-container>
            </td>
          </ng-template>
        </vdr-data-table>

        <ng-template #emptyState>
          <vdr-card>
            <div style="padding:24px;text-align:center;opacity:.7">
              No BBB servers configured
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
export class BbbServerListComponent extends BbbPaginatedListBase {
  servers: any[] = [];

  showCreateForm = false;

  editingId: string | null = null;
  editServer: any = {};

  newServer = {
    name: "",
    apiUrl: "",
    apiSecret: "",
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
            .query(GET_BBB_SERVERS, {
              options: {
                skip: (this.currentPage - 1) * this.itemsPerPage,
                take: this.itemsPerPage,
              },
            })
            .mapSingle((d: any) => ({
              items: d.bbbServers?.items ?? [],
              totalItems: d.bbbServers?.totalItems ?? 0,
            })),
        ),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (data: { items: any[]; totalItems: number }) => {
          this.servers = data.items;
          this.totalItems = data.totalItems;
          this.clampPage();
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to load BBB servers",
          );
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  load(): void {
    this.refresh$.next();
  }

  get isValidServer(): boolean {
    return !!(
      this.newServer.name &&
      this.newServer.apiUrl &&
      this.newServer.apiSecret
    );
  }

  cancelCreate(): void {
    this.showCreateForm = false;
    this.newServer = {
      name: "",
      apiUrl: "",
      apiSecret: "",
    };
  }

  createServer(): void {
    if (!this.isValidServer) {
      this.notificationService.error("All fields are required");
      return;
    }

    this.dataService
      .mutate(CREATE_BBB_SERVER, {
        input: this.newServer,
      })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Server added successfully");
          this.cancelCreate();
          this.refresh$.next();
        },
        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to create server",
          );
        },
      });
  }

  startEdit(server: any): void {
    this.editingId = server.id;
    this.editServer = {
      name: server.name,
      apiUrl: server.apiUrl,
      maxLoad: server.maxLoad,
    };
    this.cdr.markForCheck();
  }

  cancelEdit(): void {
    this.editingId = null;
    this.editServer = {};
    this.cdr.markForCheck();
  }

  saveEdit(server: any): void {
    const input: any = {};
    if (this.editServer.name !== server.name) input.name = this.editServer.name;
    if (this.editServer.apiUrl !== server.apiUrl)
      input.apiUrl = this.editServer.apiUrl;
    if (this.editServer.maxLoad !== server.maxLoad)
      input.maxLoad = this.editServer.maxLoad;

    if (Object.keys(input).length === 0) {
      this.cancelEdit();
      return;
    }

    this.dataService
      .mutate(UPDATE_BBB_SERVER, { id: server.id, input })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Server updated");
          this.cancelEdit();
          this.refresh$.next();
        },
        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to update server",
          );
        },
      });
  }

  toggleEnabled(server: any): void {
    this.dataService
      .mutate(UPDATE_BBB_SERVER, {
        id: server.id,
        input: {
          enabled: !server.enabled,
        },
      })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success(
            `Server ${server.enabled ? "disabled" : "enabled"}`,
          );
          this.refresh$.next();
        },
        error: (err: any) => {
          console.error(err);
          this.notificationService.error(err?.message ?? "Toggle failed");
        },
      });
  }

  deleteServer(server: any): void {
    if (!confirm(`Delete server "${server.name}"? This cannot be undone.`))
      return;

    this.dataService
      .mutate(DELETE_BBB_SERVER, { id: server.id })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success("Server deleted");
          this.refresh$.next();
        },
        error: (err: any) => {
          console.error(err);
          this.notificationService.error(
            err?.message ?? "Failed to delete server",
          );
        },
      });
  }
}
