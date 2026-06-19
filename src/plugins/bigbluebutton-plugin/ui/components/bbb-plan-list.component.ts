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

// ─── GraphQL ─────────────────────────────────────────────────────────────────

const GET_BBB_ORGANIZATIONS = gql`
  query GetBbbOrgsForPlans {
    bbbOrganizations {
      items {
        id
        name
        slug
      }
    }
  }
`;

const GET_BBB_CAPACITY_GRANTS = gql`
  query GetBbbCapacityGrants($organizationId: ID!) {
    bbbCapacityGrants(organizationId: $organizationId) {
      id
      grantedMinutes
      consumedMinutes
      validFrom
      validUntil
      exhausted
      orderId
    }
  }
`;

const CREATE_BBB_CAPACITY_GRANT = gql`
  mutation CreateBbbCapacityGrant($input: CreateBbbCapacityGrantInput!) {
    createBbbCapacityGrant(input: $input) {
      id
      grantedMinutes
      consumedMinutes
      validFrom
      validUntil
      exhausted
    }
  }
`;

// ─── Component ───────────────────────────────────────────────────────────────

@Component({
  selector: "bbb-plan-list",
  standalone: true,
  imports: [SharedModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vdr-page-block>
      <vdr-action-bar>
        <vdr-ab-left></vdr-ab-left>
        <vdr-ab-right>
          <button
            class="btn btn-primary"
            (click)="showCreateForm = !showCreateForm"
          >
            <clr-icon shape="plus"></clr-icon>
            Add Plan
          </button>
        </vdr-ab-right>
      </vdr-action-bar>

      <!-- ── Organization selector ──────────────────────────────────── -->
      <vdr-card title="Organization" style="margin-bottom:16px">
        <div class="form-field">
          <label>Select Organization</label>
          <select
            [(ngModel)]="selectedOrgId"
            (ngModelChange)="onOrgChange()"
            class="select"
          >
            <option *ngFor="let o of organizations" [value]="o.id">
              {{ o.name }} ({{ o.slug }})
            </option>
          </select>
        </div>
      </vdr-card>

      <!-- ── Create form ────────────────────────────────────────────── -->
      <vdr-card
        *ngIf="showCreateForm"
        title="Add Plan"
        style="margin-bottom:16px"
      >
        <div class="info-banner">
          <clr-icon shape="info-circle"></clr-icon>
          Plans grant meeting-hour capacity to an organization. Grants are
          consumed per-provisioned-meeting and picked earliest-expiry-first.
        </div>

        <div class="form-row">
          <div class="form-field">
            <label>Hours to Grant</label>
            <input
              type="number"
              [(ngModel)]="newGrant.hours"
              class="input"
              min="1"
              max="10000"
              placeholder="10"
            />
            <small class="clr-subtext">
              {{ newGrant.hours * 60 | number }} minutes total
            </small>
          </div>

          <div class="form-field">
            <label>Valid for (days)</label>
            <input
              type="number"
              [(ngModel)]="newGrant.validityDays"
              class="input"
              min="1"
              max="3650"
              placeholder="30"
            />
            <small class="clr-subtext">
              Expires {{ expiryDate | date: "mediumDate" }}
            </small>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn" (click)="cancelCreate()">Cancel</button>
          <button
            class="btn btn-primary"
            [disabled]="!canCreate || saving"
            (click)="createGrant()"
          >
            <clr-icon
              *ngIf="saving"
              shape="sync"
              class="is-spinning"
            ></clr-icon>
            Create Plan
          </button>
        </div>
      </vdr-card>

      <!-- ── Grants table ───────────────────────────────────────────── -->
      <vdr-spinner *ngIf="loading"></vdr-spinner>

      <ng-container *ngIf="!loading">
        <!-- Summary bar -->
        <vdr-card *ngIf="grants.length" style="margin-bottom:16px">
          <div class="summary-row">
            <div class="summary-item">
              <span class="summary-value"
                >{{ totalRemainingHours | number: "1.1-1" }}h</span
              >
              <span class="summary-label">Remaining</span>
            </div>
            <div class="summary-divider"></div>
            <div class="summary-item">
              <span class="summary-value"
                >{{ totalGrantedHours | number: "1.1-1" }}h</span
              >
              <span class="summary-label">Total Granted</span>
            </div>
            <div class="summary-divider"></div>
            <div class="summary-item">
              <span class="summary-value">{{ activeGrants }}</span>
              <span class="summary-label">Active Grants</span>
            </div>
            <div class="summary-divider"></div>
            <div class="summary-item">
              <span class="summary-value">{{ grants.length }}</span>
              <span class="summary-label">Total Grants</span>
            </div>
          </div>
        </vdr-card>

        <vdr-data-table
          *ngIf="grants.length; else emptyState"
          [items]="grants"
          [itemsPerPage]="itemsPerPage"
          [currentPage]="currentPage"
          [totalItems]="grants.length"
          (pageChange)="setPage($event)"
          (itemsPerPageChange)="onItemsPerPageChange($event)"
        >
          <vdr-dt-column>Status</vdr-dt-column>
          <vdr-dt-column>Hours Used / Granted</vdr-dt-column>
          <vdr-dt-column>Valid From</vdr-dt-column>
          <vdr-dt-column>Valid Until</vdr-dt-column>
          <vdr-dt-column>Source</vdr-dt-column>

          <ng-template let-g="item">
            <!-- Status -->
            <td class="left">
              <vdr-chip *ngIf="isActive(g)" colorType="success"
                >Active</vdr-chip
              >
              <vdr-chip *ngIf="g.exhausted" colorType="error"
                >Exhausted</vdr-chip
              >
              <vdr-chip *ngIf="isExpired(g) && !g.exhausted" colorType="warning"
                >Expired</vdr-chip
              >
            </td>

            <!-- Usage bar -->
            <td class="left">
              <div class="usage-label">
                {{ toHours(g.consumedMinutes) | number: "1.1-1" }}h /
                {{ toHours(g.grantedMinutes) | number: "1.1-1" }}h
              </div>
              <div class="usage-bar-bg">
                <div
                  class="usage-bar-fill"
                  [class.usage-bar-warn]="usagePct(g) > 75"
                  [class.usage-bar-danger]="usagePct(g) >= 100 || g.exhausted"
                  [style.width.%]="usagePct(g)"
                ></div>
              </div>
            </td>

            <!-- Valid From -->
            <td class="left">{{ g.validFrom | date: "mediumDate" }}</td>

            <!-- Valid Until -->
            <td class="left" [class.expired-date]="isExpired(g)">
              {{ g.validUntil | date: "mediumDate" }}
            </td>

            <!-- Source -->
            <td class="left">
              <span *ngIf="g.orderId; else manualSource">
                <clr-icon shape="shopping-cart" size="12"></clr-icon>
                Order #{{ g.orderId }}
              </span>
              <ng-template #manualSource>
                <span class="manual-badge">
                  <clr-icon shape="administrator" size="12"></clr-icon>
                  Manual
                </span>
              </ng-template>
            </td>
          </ng-template>
        </vdr-data-table>

        <ng-template #emptyState>
          <vdr-card>
            <div class="empty-state">
              <clr-icon shape="clock" size="32" style="opacity:.4"></clr-icon>
              <p>No plans yet for this organization.</p>
              <p class="empty-hint">
                Plans grant meeting-hour capacity. Without an active plan,
                meeting provisioning will fail.
              </p>
              <button class="btn btn-primary" (click)="showCreateForm = true">
                Add First Plan
              </button>
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
      .select {
        width: 100%;
        padding: 6px 8px;
        border: 1px solid var(--color-component-border-200);
        border-radius: 3px;
        background: var(--color-form-input-bg);
        color: var(--color-text-100);
      }
      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }
      .form-actions {
        display: flex;
        gap: 8px;
        margin-top: 16px;
      }
      .info-banner {
        background: var(--color-component-bg-200);
        border-left: 3px solid var(--color-warning-default);
        padding: 10px 12px;
        border-radius: 3px;
        font-size: 13px;
        margin-bottom: 16px;
        display: flex;
        gap: 8px;
        align-items: flex-start;
      }

      /* Summary bar */
      .summary-row {
        display: flex;
        align-items: center;
        gap: 0;
        padding: 4px 0;
      }
      .summary-item {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }
      .summary-value {
        font-size: 22px;
        font-weight: 600;
        color: var(--color-text-100);
      }
      .summary-label {
        font-size: 11px;
        color: var(--color-text-300);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .summary-divider {
        width: 1px;
        height: 40px;
        background: var(--color-component-border-200);
      }

      /* Usage bar */
      .usage-label {
        font-size: 12px;
        color: var(--color-text-200);
        margin-bottom: 4px;
      }
      .usage-bar-bg {
        width: 160px;
        height: 6px;
        background: var(--color-component-bg-300);
        border-radius: 3px;
        overflow: hidden;
      }
      .usage-bar-fill {
        height: 100%;
        background: var(--color-success-default, #28a745);
        border-radius: 3px;
        transition: width 0.3s ease;
        min-width: 2px;
      }
      .usage-bar-warn {
        background: var(--color-warning-default, #f0ad4e);
      }
      .usage-bar-danger {
        background: var(--color-error-default, #dc3545);
      }

      .expired-date {
        color: var(--color-error-default);
      }
      .manual-badge {
        color: var(--color-text-300);
        font-size: 12px;
      }

      /* Empty state */
      .empty-state {
        padding: 40px 24px;
        text-align: center;
        opacity: 0.85;
      }
      .empty-state p {
        margin: 8px 0;
      }
      .empty-hint {
        font-size: 13px;
        color: var(--color-text-300);
        margin-bottom: 16px;
      }
    `,
  ],
})
export class BbbPlanListComponent extends BbbPaginatedListBase {
  organizations: any[] = [];
  grants: any[] = [];
  selectedOrgId: string | null = null;
  showCreateForm = false;
  saving = false;

  newGrant = { hours: 10, validityDays: 30 };

  constructor(
    private dataService: DataService,
    private notificationService: NotificationService,
    protected cdr: ChangeDetectorRef,
  ) {
    super();
  }

  ngOnInit(): void {
    // Load orgs once
    this.dataService
      .query(GET_BBB_ORGANIZATIONS)
      .mapSingle((d: any) => d.bbbOrganizations?.items ?? [])
      .pipe(first())
      .subscribe({
        next: (orgs: any[]) => {
          this.organizations = orgs;
          if (orgs.length) {
            this.selectedOrgId = orgs[0].id;
            this.startPolling();
          }
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          this.notificationService.error(
            err?.message ?? "Failed to load organizations",
          );
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  private startPolling(): void {
    merge(interval(15_000).pipe(startWith(0)), this.refresh$)
      .pipe(
        switchMap(() =>
          this.dataService
            .query(GET_BBB_CAPACITY_GRANTS, {
              organizationId: this.selectedOrgId,
            })
            .mapSingle((d: any) => d.bbbCapacityGrants ?? []),
        ),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (grants: any[]) => {
          this.grants = grants;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          this.notificationService.error(
            err?.message ?? "Failed to load plans",
          );
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  onOrgChange(): void {
    this.grants = [];
    this.loading = true;
    this.refresh$.next();
  }

  load(): void {
    this.refresh$.next();
  }

  // ── Create ────────────────────────────────────────────────────────────────

  get canCreate(): boolean {
    return (
      !!this.selectedOrgId &&
      this.newGrant.hours > 0 &&
      this.newGrant.validityDays > 0
    );
  }

  get expiryDate(): Date {
    const d = new Date();
    d.setDate(d.getDate() + this.newGrant.validityDays);
    return d;
  }

  createGrant(): void {
    if (!this.canCreate) return;
    this.saving = true;

    this.dataService
      .mutate(CREATE_BBB_CAPACITY_GRANT, {
        input: {
          organizationId: this.selectedOrgId,
          grantedMinutes: this.newGrant.hours * 60,
        },
      })
      .pipe(first())
      .subscribe({
        next: () => {
          this.notificationService.success(
            `Plan created: ${this.newGrant.hours}h for ${this.newGrant.validityDays} days`,
          );
          this.saving = false;
          this.showCreateForm = false;
          this.newGrant = { hours: 10, validityDays: 30 };
          this.refresh$.next();
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          this.notificationService.error(
            err?.message ?? "Failed to create plan",
          );
          this.saving = false;
          this.cdr.markForCheck();
        },
      });
  }

  cancelCreate(): void {
    this.showCreateForm = false;
    this.newGrant = { hours: 10, validityDays: 30 };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  toHours(minutes: number): number {
    return (minutes ?? 0) / 60;
  }

  usagePct(g: any): number {
    if (!g.grantedMinutes) return 0;
    return Math.min(
      100,
      Math.round(((g.consumedMinutes ?? 0) / g.grantedMinutes) * 100),
    );
  }

  isActive(g: any): boolean {
    if (g.exhausted) return false;
    const now = new Date();
    return new Date(g.validFrom) <= now && new Date(g.validUntil) >= now;
  }

  isExpired(g: any): boolean {
    return new Date(g.validUntil) < new Date();
  }

  // ── Summary computed values ───────────────────────────────────────────────

  get totalGrantedHours(): number {
    return this.grants
      .filter((g) => this.isActive(g))
      .reduce((sum, g) => sum + this.toHours(g.grantedMinutes), 0);
  }

  get totalRemainingHours(): number {
    return this.grants
      .filter((g) => this.isActive(g))
      .reduce(
        (sum, g) =>
          sum +
          this.toHours((g.grantedMinutes ?? 0) - (g.consumedMinutes ?? 0)),
        0,
      );
  }

  get activeGrants(): number {
    return this.grants.filter((g) => this.isActive(g)).length;
  }
}
