import { OnDestroy, Directive } from "@angular/core";
import { Subject, BehaviorSubject } from "rxjs";

/**
 * Shared base class for all BBB list components.
 *
 * Provides standard pagination state management, page clamping,
 * and centralized page size configuration for vdr-data-table.
 *
 * NOTE: Subclasses implement their own ngOnInit() — this base
 * intentionally does NOT implement OnInit to avoid dead-code issues
 * where subclass overrides never call super.ngOnInit().
 */
@Directive()
export abstract class BbbPaginatedListBase implements OnDestroy {
  loading = false;
  currentPage = 1;
  itemsPerPage = 25;
  totalItems = 0;

  /** Page size options exposed to the vdr-data-table dropdown */
  readonly pageSizeOptions = [10, 25, 50, 100];

  protected readonly destroy$ = new Subject<void>();
  protected readonly refresh$ = new BehaviorSubject<void>(undefined);

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Called by vdr-data-table (pageChange) and internal nav.
   */
  setPage(page: number): void {
    this.currentPage = page;
    this.loading = true;
    this.load();
  }

  /**
   * Called by vdr-data-table (itemsPerPageChange).
   * Resets to page 1 when page size changes.
   */
  onItemsPerPageChange(size: number): void {
    this.itemsPerPage = size;
    this.currentPage = 1;
    this.loading = true;
    this.load();
  }

  /**
   * After loading items, clamp current page if it exceeds the available range.
   * Prevents showing an empty page after deleting many items.
   */
  protected clampPage(): void {
    const maxPage = Math.max(1, Math.ceil(this.totalItems / this.itemsPerPage));
    if (this.currentPage > maxPage) {
      this.currentPage = maxPage;
      this.refresh$.next();
    }
  }

  /**
   * Each component implements its own load() method.
   */
  abstract load(): void;
}
