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
import { EMPTY, first, BehaviorSubject, merge, interval, Subject } from "rxjs";
import { switchMap, startWith, takeUntil, debounceTime, distinctUntilChanged } from "rxjs/operators";
import { BbbPaginatedListBase } from "./bbb-paginated-list-base";

const GET_BBB_ORGANIZATIONS = gql`
  query GetBbbOrgsForEnrollments {
    bbbOrganizations { items { id name slug } }
  }
`;

const GET_BBB_ROOMS = gql`
  query GetBbbRoomsForEnrollments($organizationId: ID!) {
    bbbRooms(organizationId: $organizationId) {
      items { id name state }
    }
  }
`;

const GET_PRODUCT_ACCESS = gql`
  query GetBbbProductAccess($roomId: ID!) {
    bbbProductAccessByRoom(roomId: $roomId) {
      id productVariantId accessDays
    }
  }
`;

const GET_ENROLLMENTS = gql`
  query GetBbbEnrollmentsByRoom($roomId: ID!, $options: BbbEnrollmentListOptions) {
    bbbEnrollmentsByRoom(roomId: $roomId, options: $options) {
      items {
        id customerId customerName customerEmail
        active expiresAt validFrom validUntil source createdAt
      }
      totalItems
    }
  }
`;

const SEARCH_VARIANTS = gql`
  query BbbProductVariantSearch($term: String!) {
    bbbProductVariantSearch(term: $term) {
      id name sku productName
    }
  }
`;

const SEARCH_CUSTOMERS = gql`
  query SearchCustomersForEnrollment($term: String!) {
    customers(options: { filter: { emailAddress: { contains: $term } }, take: 10 }) {
      items { id firstName lastName emailAddress }
    }
  }
`;

const CREATE_PRODUCT_ACCESS = gql`
  mutation CreateBbbProductAccess($input: CreateBbbProductAccessInput!) {
    createBbbProductAccess(input: $input) { id productVariantId accessDays }
  }
`;

const DELETE_PRODUCT_ACCESS = gql`
  mutation DeleteBbbProductAccess($id: ID!) {
    deleteBbbProductAccess(id: $id)
  }
`;

const CREATE_ENROLLMENT = gql`
  mutation CreateBbbEnrollment($input: CreateBbbEnrollmentInput!) {
    createBbbEnrollment(input: $input) { id customerId active source }
  }
`;

const DEACTIVATE_ENROLLMENT = gql`
  mutation DeactivateBbbEnrollment($id: ID!) {
    deactivateBbbEnrollment(id: $id) { id active }
  }
`;

@Component({
  selector: "bbb-enrollment-list",
  standalone: true,
  imports: [SharedModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vdr-page-block>
      <vdr-action-bar><vdr-ab-left></vdr-ab-left></vdr-action-bar>

      <vdr-card title="Organization" style="margin-top:12px">
        <div class="form-field">
          <label>Select Organization</label>
          <select class="input" [(ngModel)]="selectedOrgId" (ngModelChange)="onOrgChange()">
            <option value="">-- Select organization --</option>
            <option *ngFor="let org of organizations" [value]="org.id">{{ org.name }}</option>
          </select>
        </div>
      </vdr-card>

      <vdr-card *ngIf="selectedOrgId" title="Room" style="margin-top:12px">
        <div class="form-field">
          <label>Select Room</label>
          <select class="input" [(ngModel)]="selectedRoomId" (ngModelChange)="onRoomChange()">
            <option value="">-- Select room --</option>
            <option *ngFor="let r of rooms" [value]="r.id">{{ r.name }} ({{ r.state }})</option>
          </select>
        </div>
      </vdr-card>

      <ng-container *ngIf="selectedRoomId">

        <!-- Product Mappings -->
        <vdr-card title="Product Mappings" style="margin-top:12px">
          <p class="hint">Customers who purchase these products are automatically enrolled in this room.</p>

          <table *ngIf="productAccess.length" class="simple-table">
            <thead><tr><th>Product / Variant</th><th>SKU</th><th>Access Days</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let pa of productAccess">
                <td>
                  <span *ngIf="pa._variantLabel; else idFallback">{{ pa._variantLabel }}</span>
                  <ng-template #idFallback><code>{{ pa.productVariantId }}</code></ng-template>
                </td>
                <td><code>{{ pa._sku || "—" }}</code></td>
                <td>{{ pa.accessDays ?? "Unlimited" }}</td>
                <td><button class="btn btn-sm btn-danger" (click)="deleteProductAccess(pa)">Remove</button></td>
              </tr>
            </tbody>
          </table>
          <p *ngIf="!productAccess.length" class="empty-hint">No products mapped yet.</p>

          <div class="add-mapping">
            <p class="hint">Search for a product variant to map:</p>
            <div class="grid-3">
              <div class="form-field" style="position:relative">
                <label>Product / Variant</label>
                <input
                  type="text"
                  class="input"
                  [(ngModel)]="variantSearch"
                  (ngModelChange)="onVariantSearch($event)"
                  [placeholder]="selectedVariant ? (selectedVariant.productName + ' — ' + selectedVariant.name) : 'Search by name or SKU…'"
                />
                <div class="dropdown" *ngIf="variantResults.length && !selectedVariant">
                  <div class="dropdown-item" *ngFor="let v of variantResults" (click)="selectVariant(v)">
                    <span class="v-product">{{ v.productName }}</span>
                    <span class="v-name">{{ v.name }} &nbsp;<code>{{ v.sku }}</code></span>
                  </div>
                </div>
                <div *ngIf="selectedVariant" class="selected-chip">
                  {{ selectedVariant.productName }} — {{ selectedVariant.name }}
                  <button class="btn-clear" (click)="clearVariant()">✕</button>
                </div>
              </div>
              <div class="form-field">
                <label>Access Days (blank = unlimited)</label>
                <input type="number" class="input" [(ngModel)]="newAccessDays" placeholder="30" />
              </div>
              <div class="form-field" style="display:flex;align-items:flex-end">
                <button class="btn btn-primary" [disabled]="!selectedVariant" (click)="addProductAccess()">Add Mapping</button>
              </div>
            </div>
          </div>
        </vdr-card>

        <!-- Manual Enrollment -->
        <vdr-card title="Add Enrollment" style="margin-top:12px">
          <p class="hint">Manually enroll a customer (e.g. scholarship, demo, support). Source is recorded as <code>admin</code>.</p>
          <div class="grid-3">
            <div class="form-field" style="position:relative">
              <label>Customer</label>
              <input
                type="text"
                class="input"
                [(ngModel)]="enrollCustomerSearch"
                (ngModelChange)="onEnrollCustomerSearch($event)"
                [placeholder]="enrollSelectedCustomer ? enrollSelectedCustomer.emailAddress : 'Search by email…'"
              />
              <div class="dropdown" *ngIf="enrollCustomerResults.length && !enrollSelectedCustomer">
                <div class="dropdown-item" *ngFor="let c of enrollCustomerResults" (click)="selectEnrollCustomer(c)">
                  <span class="customer-name">{{ c.firstName }} {{ c.lastName }}</span>
                  <span class="customer-email">{{ c.emailAddress }}</span>
                </div>
              </div>
              <div *ngIf="enrollSelectedCustomer" class="selected-chip">
                {{ enrollSelectedCustomer.firstName }} {{ enrollSelectedCustomer.lastName }} — {{ enrollSelectedCustomer.emailAddress }}
                <button class="btn-clear" (click)="clearEnrollCustomer()">✕</button>
              </div>
            </div>
            <div class="form-field">
              <label>Access Days (blank = unlimited)</label>
              <input type="number" class="input" [(ngModel)]="enrollAccessDays" placeholder="30" />
            </div>
            <div class="form-field" style="display:flex;align-items:flex-end">
              <button class="btn btn-primary" [disabled]="!enrollSelectedCustomer" (click)="addEnrollment()">Enroll</button>
            </div>
          </div>
        </vdr-card>

        <!-- Enrollments table -->
        <vdr-card title="Enrollments" style="margin-top:12px">
          <div class="enrollment-stats" *ngIf="totalItems > 0">
            <span class="stat active">Active: {{ activeCount }}</span>
            <span class="stat expired">Expired / Inactive: {{ totalItems - activeCount }}</span>
          </div>

          <vdr-spinner *ngIf="loading"></vdr-spinner>

          <ng-container *ngIf="!loading">
            <vdr-data-table
              *ngIf="enrollments.length; else noEnrollments"
              [items]="enrollments"
              [itemsPerPage]="itemsPerPage"
              [currentPage]="currentPage"
              [totalItems]="totalItems"
              (pageChange)="setPage($event)"
              (itemsPerPageChange)="onItemsPerPageChange($event)"
            >
              <vdr-dt-column>Customer</vdr-dt-column>
              <vdr-dt-column>Email</vdr-dt-column>
              <vdr-dt-column>Source</vdr-dt-column>
              <vdr-dt-column>Status</vdr-dt-column>
              <vdr-dt-column>Expires</vdr-dt-column>
              <vdr-dt-column>Enrolled</vdr-dt-column>
              <vdr-dt-column></vdr-dt-column>
              <ng-template let-e="item">
                <td class="left">{{ e.customerName || "—" }}</td>
                <td class="left">{{ e.customerEmail || "—" }}</td>
                <td class="left"><vdr-chip>{{ e.source }}</vdr-chip></td>
                <td class="left">
                  <vdr-chip [colorType]="isActive(e) ? 'success' : 'warning'">
                    {{ isActive(e) ? "Active" : "Expired/Inactive" }}
                  </vdr-chip>
                </td>
                <td class="left">{{ (e.validUntil || e.expiresAt) ? ((e.validUntil || e.expiresAt) | date:'mediumDate') : "Never" }}</td>
                <td class="left">{{ e.createdAt | date:'mediumDate' }}</td>
                <td class="left">
                  <button *ngIf="e.active" class="btn btn-sm btn-danger" (click)="deactivate(e)">Revoke</button>
                </td>
              </ng-template>
            </vdr-data-table>
            <ng-template #noEnrollments>
              <div style="padding:24px;text-align:center;opacity:.7">No enrollments yet.</div>
            </ng-template>
          </ng-container>
        </vdr-card>

      </ng-container>
    </vdr-page-block>
  `,
  styles: [`
    .form-field { margin-bottom: 14px; }
    .form-field label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: var(--color-text-200); }
    .input { width: 100%; padding: 6px 8px; border: 1px solid var(--color-component-border-200); border-radius: 3px; background: var(--color-form-input-bg); color: var(--color-text-100); }
    .hint { font-size: 13px; color: var(--color-text-300); margin-bottom: 12px; }
    .empty-hint { font-size: 13px; color: var(--color-text-300); }
    .simple-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
    .simple-table th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--color-component-border-200); color: var(--color-text-200); font-weight: 500; }
    .simple-table td { padding: 6px 8px; border-bottom: 1px solid var(--color-component-border-100); }
    .add-mapping { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-component-border-100); }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; align-items: start; }
    .dropdown { position: absolute; z-index: 10; background: var(--color-component-bg-100); border: 1px solid var(--color-component-border-200); border-radius: 3px; width: 100%; max-height: 200px; overflow-y: auto; }
    .dropdown-item { padding: 8px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
    .dropdown-item:hover { background: var(--color-component-bg-200); }
    .v-product { font-size: 11px; color: var(--color-text-300); }
    .v-name { font-size: 13px; font-weight: 500; }
    .customer-name { font-size: 13px; font-weight: 500; }
    .customer-email { font-size: 11px; color: var(--color-text-300); }
    .selected-chip { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; padding: 5px 10px; background: var(--color-component-bg-200); border-radius: 3px; font-size: 13px; }
    .btn-clear { background: none; border: none; cursor: pointer; color: var(--color-text-300); font-size: 14px; line-height: 1; }
    .enrollment-stats { display: flex; gap: 16px; margin-bottom: 12px; font-size: 13px; }
    .stat { padding: 4px 10px; border-radius: 12px; font-weight: 500; }
    .stat.active { background: var(--color-success-50, #f0fdf4); color: var(--color-success-700, #15803d); }
    .stat.expired { background: var(--color-warning-50, #fffbeb); color: var(--color-warning-700, #b45309); }
  `],
})
export class BbbEnrollmentListComponent extends BbbPaginatedListBase {
  organizations: any[] = [];
  rooms: any[] = [];
  productAccess: any[] = [];
  enrollments: any[] = [];

  selectedOrgId = "";
  selectedRoomId = "";
  activeCount = 0;

  // Variant search
  variantSearch = "";
  variantResults: any[] = [];
  selectedVariant: any = null;
  newAccessDays: number | null = null;

  // Manual enrollment
  enrollCustomerSearch = "";
  enrollCustomerResults: any[] = [];
  enrollSelectedCustomer: any = null;
  enrollAccessDays: number | null = null;

  private readonly roomChange$ = new BehaviorSubject<string>("");
  private readonly variantSearch$ = new Subject<string>();
  private readonly enrollSearch$ = new Subject<string>();

  constructor(
    private dataService: DataService,
    private notificationService: NotificationService,
    protected cdr: ChangeDetectorRef,
  ) {
    super();
  }

  ngOnInit(): void {
    this.loadOrganizations();

    // Variant search
    this.variantSearch$.pipe(
      debounceTime(300), distinctUntilChanged(),
      switchMap((term) => {
        if (term.length < 2) { this.variantResults = []; this.cdr.markForCheck(); return EMPTY; }
        return this.dataService.query(SEARCH_VARIANTS, { term }).mapSingle((d: any) => d.bbbProductVariantSearch ?? []);
      }),
      takeUntil(this.destroy$),
    ).subscribe({ next: (r: any[]) => { this.variantResults = r; this.cdr.markForCheck(); } });

    // Customer search for manual enrollment
    this.enrollSearch$.pipe(
      debounceTime(300), distinctUntilChanged(),
      switchMap((term) => {
        if (term.length < 2) { this.enrollCustomerResults = []; this.cdr.markForCheck(); return EMPTY; }
        return this.dataService.query(SEARCH_CUSTOMERS, { term }).mapSingle((d: any) => d.customers?.items ?? []);
      }),
      takeUntil(this.destroy$),
    ).subscribe({ next: (r: any[]) => { this.enrollCustomerResults = r; this.cdr.markForCheck(); } });

    // Enrollment list stream
    this.roomChange$.pipe(
      switchMap((roomId) => {
        if (!roomId) { this.enrollments = []; this.productAccess = []; this.totalItems = 0; this.loading = false; this.cdr.markForCheck(); return EMPTY; }
        this.loading = true; this.cdr.markForCheck();
        this.loadProductAccess(roomId);
        return merge(this.refresh$.pipe(startWith(undefined)), interval(15_000)).pipe(
          switchMap(() =>
            this.dataService.query(GET_ENROLLMENTS, {
              roomId,
              options: { skip: (this.currentPage - 1) * this.itemsPerPage, take: this.itemsPerPage },
            }).mapSingle((d: any) => ({
              items: d.bbbEnrollmentsByRoom?.items ?? [],
              totalItems: d.bbbEnrollmentsByRoom?.totalItems ?? 0,
            })),
          ),
        );
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: (data: { items: any[]; totalItems: number }) => {
        this.enrollments = data.items;
        this.totalItems = data.totalItems;
        this.activeCount = data.items.filter((e: any) => this.isActive(e)).length;
        this.clampPage(); this.loading = false; this.cdr.markForCheck();
      },
      error: (err: any) => { this.loading = false; this.notificationService.error(err?.message ?? "Failed to load enrollments"); this.cdr.markForCheck(); },
    });
  }

  load(): void { if (this.selectedRoomId) this.refresh$.next(); }

  isActive(e: any): boolean {
    const now = new Date();
    if (!e.active) return false;
    if (e.validUntil && new Date(e.validUntil) < now) return false;
    if (!e.validUntil && e.expiresAt && new Date(e.expiresAt) < now) return false;
    return true;
  }

  onOrgChange(): void {
    this.rooms = []; this.selectedRoomId = ""; this.roomChange$.next("");
    if (!this.selectedOrgId) return;
    this.dataService.query(GET_BBB_ROOMS, { organizationId: this.selectedOrgId })
      .mapSingle((d: any) => d.bbbRooms?.items ?? []).pipe(first())
      .subscribe({ next: (r: any[]) => { this.rooms = r; this.cdr.markForCheck(); } });
  }

  onRoomChange(): void { this.currentPage = 1; this.roomChange$.next(this.selectedRoomId); }

  // Variant search
  onVariantSearch(term: string): void { this.selectedVariant = null; this.variantSearch$.next(term); }
  selectVariant(v: any): void { this.selectedVariant = v; this.variantSearch = ""; this.variantResults = []; this.cdr.markForCheck(); }
  clearVariant(): void { this.selectedVariant = null; this.variantSearch = ""; this.variantResults = []; this.cdr.markForCheck(); }

  // Customer search
  onEnrollCustomerSearch(term: string): void { this.enrollSelectedCustomer = null; this.enrollSearch$.next(term); }
  selectEnrollCustomer(c: any): void { this.enrollSelectedCustomer = c; this.enrollCustomerSearch = ""; this.enrollCustomerResults = []; this.cdr.markForCheck(); }
  clearEnrollCustomer(): void { this.enrollSelectedCustomer = null; this.enrollCustomerSearch = ""; this.enrollCustomerResults = []; this.cdr.markForCheck(); }

  private loadOrganizations(): void {
    this.dataService.query(GET_BBB_ORGANIZATIONS).mapSingle((d: any) => d.bbbOrganizations?.items ?? []).pipe(first())
      .subscribe({ next: (o: any[]) => { this.organizations = o; this.cdr.markForCheck(); } });
  }

  private loadProductAccess(roomId: string): void {
    this.dataService.query(GET_PRODUCT_ACCESS, { roomId }).mapSingle((d: any) => d.bbbProductAccessByRoom ?? []).pipe(first())
      .subscribe({ next: (pa: any[]) => { this.productAccess = pa; this.cdr.markForCheck(); } });
  }

  addProductAccess(): void {
    if (!this.selectedVariant) return;
    this.dataService.mutate(CREATE_PRODUCT_ACCESS, {
      input: { roomId: this.selectedRoomId, productVariantId: this.selectedVariant.id, accessDays: this.newAccessDays || null },
    }).pipe(first()).subscribe({
      next: () => {
        this.notificationService.success("Mapping added");
        this.clearVariant(); this.newAccessDays = null;
        this.loadProductAccess(this.selectedRoomId);
      },
      error: (err: any) => this.notificationService.error(err?.message ?? "Failed to add mapping"),
    });
  }

  deleteProductAccess(pa: any): void {
    this.dataService.mutate(DELETE_PRODUCT_ACCESS, { id: pa.id }).pipe(first()).subscribe({
      next: () => { this.notificationService.success("Mapping removed"); this.loadProductAccess(this.selectedRoomId); },
      error: (err: any) => this.notificationService.error(err?.message ?? "Failed to remove mapping"),
    });
  }

  addEnrollment(): void {
    if (!this.enrollSelectedCustomer) return;
    this.dataService.mutate(CREATE_ENROLLMENT, {
      input: { roomId: this.selectedRoomId, customerId: this.enrollSelectedCustomer.id, accessDays: this.enrollAccessDays || null },
    }).pipe(first()).subscribe({
      next: () => {
        this.notificationService.success("Enrollment created");
        this.clearEnrollCustomer(); this.enrollAccessDays = null;
        this.refresh$.next();
      },
      error: (err: any) => this.notificationService.error(err?.message ?? "Failed to create enrollment"),
    });
  }

  deactivate(enrollment: any): void {
    this.dataService.mutate(DEACTIVATE_ENROLLMENT, { id: enrollment.id }).pipe(first()).subscribe({
      next: () => { this.notificationService.success("Enrollment revoked"); this.refresh$.next(); },
      error: (err: any) => this.notificationService.error(err?.message ?? "Failed to revoke enrollment"),
    });
  }
}
