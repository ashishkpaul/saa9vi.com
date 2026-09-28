import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  api,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@vendure/dashboard';
import { graphql } from '@/gql';
import { reconcileOrgSelection, useSelectedOrgId } from './orgStore';

const GET_ORGS = graphql(`
  query BbbOrgSwitcher($options: BbbOrganizationListOptions) {
    bbbOrganizations(options: $options) { items { id name slug suspended } totalItems }
  }
`);

export interface SwitcherOrg {
  id: string;
  name: string;
  slug: string;
  suspended: boolean;
}

/**
 * DEV/TEST-ONLY UX heuristic. This regex must never become a domain concept
 * (no `isTestTenant` column, invariant, or backend rule). It only hides
 * noisy automated-test tenants in the picker; replace with an explicit
 * persisted flag / authoritative classification when available.
 */
const TEST_TENANT = /^(adr\d+|freebasic|probe|e2e|slice\d|g[23]-)/i;
export const isTestTenant = (o: SwitcherOrg) => TEST_TENANT.test(o.slug);
export const orgLabel = (o: SwitcherOrg) =>
  `${o.name}${o.slug === '__default_channel__' ? '' : ` · ${o.slug}`}${
    o.suspended ? ' (suspended)' : ''
  }`;

/**
 * TEMPORARY mitigation: server clamps take to max 100
 * (BbbOrganizationService.findAll: Math.min(...,100)). Requesting 100
 * surfaces orgs past the old default page of 25, but this is NOT "load all".
 * Real fix: server-side filter/sort + search (Slice 4).
 */
const SWITCHER_TAKE = 100;

export function useBbbOrgs() {
  const query = useQuery<{ bbbOrganizations: { items: SwitcherOrg[]; totalItems: number } }>({
    queryKey: ['bbbOrgSwitcher'],
    queryFn: () => api.query(GET_ORGS, { options: { skip: 0, take: SWITCHER_TAKE } }),
    staleTime: 5 * 60 * 1000,
  });
  // Validate the remembered selection against the real list as soon as it is
  // available (see reconcileOrgSelection): until then routes observe '' and
  // keep their queries disabled, so a stale ID can never fire an invalid
  // request. An empty/failed list leaves the selection unvalidated.
  const orgs = query.data?.bbbOrganizations?.items;
  useEffect(() => {
    if (!query.isLoading && !query.isError && orgs?.length) {
      reconcileOrgSelection(orgs.map(o => o.id));
    }
  }, [query.isLoading, query.isError, orgs]);
  return query;
}

export function OrgSwitcher({ label = 'Organization' }: { label?: string }) {
  const { data, isLoading, isError } = useBbbOrgs();
  const [selected, setSelected] = useSelectedOrgId();
  const [hideTests, setHideTests] = useState(true);

  const all = data?.bbbOrganizations?.items ?? [];
  const labelById = useMemo(() => new Map(all.map((o) => [o.id, orgLabel(o)] as const)), [all]);
  const visible = useMemo(
    () => all.filter((o) => !hideTests || !isTestTenant(o) || o.id === selected),
    [all, hideTests, selected],
  );

  // Selection fallback ("remembered ID no longer resolves to an org → first
  // available org") lives in reconcileOrgSelection, invoked from useBbbOrgs
  // once the list has loaded — so validation happens exactly once per fetch.

  // Base UI renders SelectValue from the registered SelectItem text when no
  // `items` record is available on this Vendure Select wrapper; the function
  // child guarantees the name (not raw id) is shown in the trigger.
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="grid gap-1.5 min-w-[280px]">
        <Label>{label}</Label>
        <Select value={selected} onValueChange={(v) => v && setSelected(v)}>
          <SelectTrigger>
            <SelectValue placeholder={isLoading ? 'Loading…' : 'Select organization'}>
              {(v) => (typeof v === 'string' && labelById.get(v)) || undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {visible.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {orgLabel(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isError && (
          <p className="text-xs text-destructive" role="alert">
            Couldn&apos;t load organizations — the remembered selection is kept; retry once the API is reachable.
          </p>
        )}
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
        <Switch checked={hideTests} onCheckedChange={setHideTests} />
        Hide test tenants ({all.filter(isTestTenant).length})
      </label>
    </div>
  );
}
