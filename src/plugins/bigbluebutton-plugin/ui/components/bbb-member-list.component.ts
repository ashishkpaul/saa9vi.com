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
import { EMPTY, first, merge, interval, BehaviorSubject } from "rxjs";
import { switchMap, startWith, takeUntil, debounceTime, distinctUntilChanged } from "rxjs/operators";
import { Subject } from "rxjs";
import { BbbPaginatedListBase } from "./bbb-paginated-list-base";

const GET_BBB_ORGANIZATIONS = gql`
  query GetBbbOrganizationsForStaff {
    bbbOrganizations {
      items { id name slug }
      totalItems
    }
  }
`;

const SEARCH_CUSTOMERS = gql`
  query SearchCustomersForBbb($term: String!) {
    customers(options: { filter: { emailAddress: { contains: $term } }, take: 10 }) {
      items { id firstName lastName emailAddress }
    }
  }
`;

const GET_BBB_ORGANIZATION_MEMBERS = gql`
  query GetBbbOrganizationStaff(
    $organizationId: ID!
    $options: BbbOrganizationMemberListOptions
  ) {
    bbbOrganizationMembers(organizationId: $organizationId, options: $options) {
      items {
        id customerId customerName customerEmail role active createdAt updatedAt
      }
      totalItems
    }
  }
`;

const ADD_BBB_MEMBER = gql`
  mutation AddBbbStaffMember($input: AddBbbMemberInput!) {
    addBbbMember(input: $input) {
      id customerId role active
    }
  }
`;

const UPDATE_BBB_MEMBER = gql`
  mutation UpdateBbbStaffMember($id: ID!, $input: UpdateBbbMemberInput!) {
    updateBbbMember(id: $id, input: $input) {
      id customerId role active
    }
  }
`;

const REMOVE_BBB_MEMBER = gql`
  mutation RemoveBbbStaffMember($id: ID!) {
    removeBbbMember(id: $id) {
      id active
    }
  }
`;

@Component({
  selector: "bbb-member-list",
  standalone: true,
  imports: [SharedModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vdr-page-block>
      <vdr-action-bar><vdr-ab-left></vdr-ab-left></vdr-action-bar>

      <vdr-card title="Organization" style="margin-top:12px">
        <div class="form-field">
          <label>Select Organization</label>
          <select class="input" [(ngModel)]="selectedOrganizationId" (ngModelChange)="onOrganizationChange()">
            <option value="">-- Select organization --</option>
            <option *ngFor="let org of organizations" [value]="org.id">{{ org.name }} ({{ org.slug }})</option>
          </select>
        </div>
      </vdr-card>

      <vdr-card *ngIf="selectedOrganizationId" style="margin-top:12px">
        <div class="info-banner">
          <span class="info-icon">ℹ</span>
          <span>
            Organization memberships are for <strong>administrators and trainers</strong> only.
            Students gain room access automatically through course purchases — manage them in
            <strong>Enrollments</strong>.
          </span>
        </div>
      </vdr-card>

      <vdr-card *ngIf="selectedOrganizationId" title="Add Staff Member" style="margin-top:12px">
        <div class="grid-2">
          <div class="form-field">
            <label>Search Customer</label>
            <input
              type="text"
              class="input"
              [(ngModel)]="customerSearch"
              (ngModelChange)="onCustomerSearch($event)"
              [placeholder]="selectedCustomer ? selectedCustomer.emailAddress : 'Search by email or name…'"
            />
            <div class="dropdown" *ngIf="customerResults.length && !selectedCustomer">
              <div
                class="dropdown-item"
                *ngFor="let c of customerResults"
                (click)="selectCustomer(c)"
              >
                <span class="customer-name">{{ c.firstName }} {{ c.lastName }}</span>
                <span class="customer-email">{{ c.emailAddress }}</span>
              </div>
            </div>
            <div *ngIf="selectedCustomer" class="selected-customer">
              <span>{{ selectedCustomer.firstName }} {{ selectedCustomer.lastName }} — {{ selectedCustomer.emailAddress }}</span>
              <button class="btn-clear" (click)="clearCustomer()">✕</button>
            </div>
          </div>

          <div class="form-field">
            <label>Role</label>
            <select class="input" [(ngModel)]="newMemberRole">
              <option value="trainer">trainer</option>
              <option value="org-admin">org-admin</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" [disabled]="!canAdd" (click)="addMember()">Add Staff Member</button>
        </div>
      </vdr-card>

      <vdr-spinner *ngIf="loading"></vdr-spinner>

      <ng-container *ngIf="!loading">
        <vdr-data-table
          *ngIf="members.length; else emptyState"
          [items]="members"
          [itemsPerPage]="itemsPerPage"
          [currentPage]="currentPage"
          [totalItems]="totalItems"
          (pageChange)="setPage($event)"
          (itemsPerPageChange)="onItemsPerPageChange($event)"
        >
          <vdr-dt-column>Name</vdr-dt-column>
          <vdr-dt-column>Email</vdr-dt-column>
          <vdr-dt-column>Role</vdr-dt-column>
          <vdr-dt-column>Status</vdr-dt-column>
          <vdr-dt-column>Actions</vdr-dt-column>

          <ng-template let-member="item">
            <td class="left">{{ member.customerName || "—" }}</td>
            <td class="left">{{ member.customerEmail || "—" }}</td>
            <td class="left">
              <select class="input" [(ngModel)]="member.role" (change)="updateRole(member)">
                <option value="trainer">trainer</option>
                <option value="org-admin">org-admin</option>
              </select>
            </td>
            <td class="left">
              <vdr-chip [colorType]="member.active ? 'success' : 'warning'">
                {{ member.active ? "Active" : "Inactive" }}
              </vdr-chip>
            </td>
            <td class="left">
              <button class="btn btn-sm" (click)="toggleActive(member)">{{ member.active ? "Deactivate" : "Activate" }}</button>
              <button class="btn btn-sm btn-danger" (click)="removeMember(member)">Remove</button>
            </td>
          </ng-template>
        </vdr-data-table>

        <ng-template #emptyState>
          <vdr-card *ngIf="selectedOrganizationId" style="margin-top:16px">
            <div style="padding:24px;text-align:center;opacity:.7">No staff members found</div>
          </vdr-card>
        </ng-template>
      </ng-container>
    </vdr-page-block>
  `,
  styles: [`
    .form-field { margin-bottom: 14px; position: relative; }
    .form-field label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: var(--color-text-200); }
    .input { width: 100%; padding: 6px 8px; border: 1px solid var(--color-component-border-200); border-radius: 3px; background: var(--color-form-input-bg); color: var(--color-text-100); }
    .form-actions { display: flex; gap: 8px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .dropdown { position: absolute; z-index: 10; background: var(--color-component-bg-100); border: 1px solid var(--color-component-border-200); border-radius: 3px; width: 100%; max-height: 200px; overflow-y: auto; }
    .dropdown-item { padding: 8px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
    .dropdown-item:hover { background: var(--color-component-bg-200); }
    .customer-name { font-size: 13px; font-weight: 500; }
    .customer-email { font-size: 11px; color: var(--color-text-300); }
    .selected-customer { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; padding: 6px 10px; background: var(--color-component-bg-200); border-radius: 3px; font-size: 13px; }
    .btn-clear { background: none; border: none; cursor: pointer; color: var(--color-text-300); font-size: 14px; line-height: 1; }
    .info-banner { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; background: var(--color-warning-50, #fffbeb); border: 1px solid var(--color-warning-200, #fde68a); border-radius: 4px; font-size: 13px; color: var(--color-text-100); }
    .info-icon { flex-shrink: 0; font-size: 16px; color: var(--color-warning-500, #d97706); margin-top: 1px; }
  `],
})
export class BbbMemberListComponent extends BbbPaginatedListBase {
  organizations: any[] = [];
  members: any[] = [];
  selectedOrganizationId = "";

  // Customer search state
  customerSearch = "";
  customerResults: any[] = [];
  selectedCustomer: any = null;
  newMemberRole = "trainer";

  private readonly orgChange$ = new BehaviorSubject<string>("");
  private readonly search$ = new Subject<string>();

  constructor(
    private dataService: DataService,
    private notificationService: NotificationService,
    protected cdr: ChangeDetectorRef,
  ) {
    super();
  }

  ngOnInit(): void {
    this.loadOrganizations();

    // Customer search with debounce
    this.search$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((term) => {
        if (term.length < 2) { this.customerResults = []; this.cdr.markForCheck(); return EMPTY; }
        return this.dataService.query(SEARCH_CUSTOMERS, { term }).mapSingle((d: any) => d.customers?.items ?? []);
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: (results: any[]) => { this.customerResults = results; this.cdr.markForCheck(); },
    });

    // Staff list stream
    this.orgChange$.pipe(
      switchMap((orgId) => {
        if (!orgId) { this.members = []; this.totalItems = 0; this.loading = false; this.cdr.markForCheck(); return EMPTY; }
        this.loading = true; this.cdr.markForCheck();
        return merge(this.refresh$.pipe(startWith(undefined)), interval(15_000)).pipe(
          switchMap(() =>
            this.dataService.query(GET_BBB_ORGANIZATION_MEMBERS, {
              organizationId: orgId,
              options: { skip: (this.currentPage - 1) * this.itemsPerPage, take: this.itemsPerPage },
            }).mapSingle((d: any) => ({
              items: d.bbbOrganizationMembers?.items ?? [],
              totalItems: d.bbbOrganizationMembers?.totalItems ?? 0,
            })),
          ),
        );
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: (data: { items: any[]; totalItems: number }) => {
        this.members = data.items; this.totalItems = data.totalItems; this.clampPage(); this.loading = false; this.cdr.markForCheck();
      },
      error: (err: any) => { this.loading = false; this.notificationService.error(err?.message ?? "Failed to load staff"); this.cdr.markForCheck(); },
    });
  }

  load(): void { if (this.selectedOrganizationId) this.refresh$.next(); }

  get canAdd(): boolean {
    return !!(this.selectedOrganizationId && this.selectedCustomer && this.newMemberRole);
  }

  onOrganizationChange(): void {
    this.members = []; this.currentPage = 1; this.totalItems = 0;
    this.orgChange$.next(this.selectedOrganizationId);
  }

  onCustomerSearch(term: string): void {
    this.selectedCustomer = null;
    this.search$.next(term);
  }

  selectCustomer(customer: any): void {
    this.selectedCustomer = customer;
    this.customerSearch = "";
    this.customerResults = [];
    this.cdr.markForCheck();
  }

  clearCustomer(): void {
    this.selectedCustomer = null;
    this.customerSearch = "";
    this.customerResults = [];
    this.cdr.markForCheck();
  }

  private loadOrganizations(): void {
    this.loading = true;
    this.dataService.query(GET_BBB_ORGANIZATIONS).mapSingle((d: any) => d.bbbOrganizations?.items ?? []).pipe(first()).subscribe({
      next: (orgs: any[]) => { this.organizations = orgs; this.loading = false; this.cdr.markForCheck(); },
      error: (err: any) => { this.loading = false; this.notificationService.error(err?.message ?? "Failed to load organizations"); this.cdr.markForCheck(); },
    });
  }

  addMember(): void {
    if (!this.canAdd) return;
    this.dataService.mutate(ADD_BBB_MEMBER, {
      input: { organizationId: this.selectedOrganizationId, customerId: this.selectedCustomer.id, role: this.newMemberRole },
    }).pipe(first()).subscribe({
      next: () => { this.notificationService.success("Staff member added"); this.clearCustomer(); this.newMemberRole = "trainer"; this.refresh$.next(); },
      error: (err: any) => { this.notificationService.error(err?.message ?? "Failed to add staff member"); },
    });
  }

  updateRole(member: any): void {
    this.dataService.mutate(UPDATE_BBB_MEMBER, { id: member.id, input: { role: member.role } }).pipe(first()).subscribe({
      next: () => { this.notificationService.success("Role updated"); this.refresh$.next(); },
      error: (err: any) => this.notificationService.error(err?.message ?? "Failed to update role"),
    });
  }

  toggleActive(member: any): void {
    this.dataService.mutate(UPDATE_BBB_MEMBER, { id: member.id, input: { active: !member.active } }).pipe(first()).subscribe({
      next: () => { this.notificationService.success("Status updated"); this.refresh$.next(); },
      error: (err: any) => this.notificationService.error(err?.message ?? "Failed to update member"),
    });
  }

  removeMember(member: any): void {
    this.dataService.mutate(REMOVE_BBB_MEMBER, { id: member.id }).pipe(first()).subscribe({
      next: () => { this.notificationService.success("Staff member removed"); this.refresh$.next(); },
      error: (err: any) => this.notificationService.error(err?.message ?? "Failed to remove member"),
    });
  }
}
