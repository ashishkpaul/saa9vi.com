import { useSyncExternalStore } from 'react';

/**
 * Tiny cross-page store for the "currently selected BBB organization".
 * Each dashboard route is mounted independently by defineDashboardExtension,
 * so a React context would not be shared between pages — a module-level
 * store (persisted to localStorage) is.
 */
const KEY = 'bbb.selectedOrgId';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}
let current = read();

/**
 * False until the organization list has confirmed `current` (see
 * `reconcileOrgSelection`). While unconfirmed, `useSelectedOrgId` exposes `''`
 * so dependent route queries stay disabled — a stale localStorage value can
 * never fire an invalid GraphQL request; routes render their "Select an
 * organization" empty state until validation lands.
 */
let validated = false;

function persist(id: string) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

function notify() {
  listeners.forEach((l) => l());
}

/** An explicit user choice is authoritative — expose it immediately. */
export function setSelectedOrgId(id: string) {
  validated = true;
  current = id;
  persist(id);
  notify();
}

/**
 * Called by `useBbbOrgs` once the organization list has loaded: keeps the
 * remembered ID when it still resolves to an org, otherwise falls back to the
 * first available organization (nothing valid is remembered). An empty or
 * failed list never validates — routes stay unvalidated rather than querying
 * with an ID we cannot vouch for.
 */
export function reconcileOrgSelection(ids: string[]) {
  if (!ids.length) return;
  const next = ids.includes(current) ? current : ids[0];
  const firstValidation = !validated;
  validated = true;
  if (next !== current) {
    current = next;
    persist(next);
    notify();
  } else if (firstValidation) {
    notify(); // expose the remembered ID now that it is confirmed
  }
}

export function useSelectedOrgId(): [string, (id: string) => void] {
  const id = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => (validated ? current : ''),
    () => '',
  );
  return [id, setSelectedOrgId];
}
