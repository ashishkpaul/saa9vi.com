import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { OrgSwitcher, useBbbOrgs } from '../../shared/OrgSwitcher';
import { useSelectedOrgId } from '../../shared/orgStore';
import { PageHeader, EmptyState } from '../../shared/PageHeader';
import { GrantStatusBadge } from '../../shared/StatusBadge';
import { formatDate, formatRelative, formatDateTime } from '../../shared/dates';

const GET_GRANTS = `
  query GetBbbCapacityGrants($organizationId: ID!) {
    bbbCapacityGrants(organizationId: $organizationId) {
      items {
        id
        grantedMinutes
        consumedMinutes
        validFrom
        validUntil
        exhausted
        orderId
        orderLineId
        productVariantId
      }
      totalItems
    }
  }
`;

const CREATE_GRANT = `
  mutation CreateBbbCapacityGrant($input: CreateBbbCapacityGrantInput!) {
    createBbbCapacityGrant(input: $input) {
      id grantedMinutes consumedMinutes validFrom validUntil exhausted
    }
  }
`;

interface Grant {
  id: string; grantedMinutes: number; consumedMinutes: number;
  validFrom: string; validUntil: string; exhausted: boolean; orderId?: string;
  orderLineId?: string; productVariantId?: string;
}

interface GrantList {
  items: Grant[];
  totalItems: number;
}

export function PlansList() {
  const qc = useQueryClient();
  const [selectedOrgId] = useSelectedOrgId();
  const [showCreate, setShowCreate] = useState(false);
  const [hours, setHours] = useState(10);
  const [validityDays, setValidityDays] = useState(30);
  const [saving, setSaving] = useState(false);

  // Shared org list (single fetch, cached 5 min) keeps the switcher warm.
  useBbbOrgs();

  const grantsQuery = useQuery<{ bbbCapacityGrants: GrantList }>({
    queryKey: ['bbbGrants', selectedOrgId],
    queryFn: () => api.query(GET_GRANTS, { organizationId: selectedOrgId }),
    enabled: !!selectedOrgId,
  });
  const grants = grantsQuery.data?.bbbCapacityGrants?.items ?? [];

  function isActive(g: Grant) {
    if (g.exhausted) return false;
    const now = new Date();
    return new Date(g.validFrom) <= now && new Date(g.validUntil) >= now;
  }

  function isExpired(g: Grant) {
    return new Date(g.validUntil) < new Date();
  }

  function toHours(minutes: number) { return (minutes ?? 0) / 60; }

  /**
   * `grantedMinutes === -1` is the sentinel for an UNBOUNDED grant
   * (internal_overhead). It is not negative capacity: feeding it into a total
   * subtracts 1/60h, and `(-1 - consumed)` makes "Remaining" go negative, so
   * unbounded grants are excluded from both aggregates and reported separately.
   */
  function isUnbounded(g: Grant) {
    return (g.grantedMinutes ?? 0) < 0;
  }

  function usagePct(g: Grant) {
    // An unbounded grant has no denominator, so it has no progress bar.
    if (isUnbounded(g) || !g.grantedMinutes) return 0;
    return Math.min(100, Math.round(((g.consumedMinutes ?? 0) / g.grantedMinutes) * 100));
  }

  const activeGrants = grants.filter(g => isActive(g));
  const boundedGrants = activeGrants.filter(g => !isUnbounded(g));
  const unboundedGrants = activeGrants.filter(isUnbounded);
  const totalGrantedHours = boundedGrants.reduce((s, g) => s + toHours(g.grantedMinutes), 0);
  const totalRemainingHours = boundedGrants.reduce(
    (s, g) => s + toHours(g.grantedMinutes - (g.consumedMinutes ?? 0)),
    0,
  );

  async function createGrant() {
    if (!selectedOrgId || hours <= 0 || validityDays <= 0) return;
    setSaving(true);
    try {
      const now = new Date();
      const validFrom = now.toISOString();
      const validUntil = new Date(now.getTime() + validityDays * 86400000).toISOString();
      await api.mutate(CREATE_GRANT, {
        input: {
          organizationId: selectedOrgId,
          grantedMinutes: hours * 60,
          validFrom,
          validUntil,
        },
      });
      qc.invalidateQueries({ queryKey: ['bbbGrants'] });
      toast.success(`Plan created: ${hours}h`);
      setShowCreate(false);
      setHours(10);
      setValidityDays(30);
    } catch (err: any) {
        toast.error('Error', { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + validityDays);

  return (
    <div className="p-6">
      <PageHeader
        title="Capacity"
        description="Meeting hours this organization can use. Oldest-expiring hours are used first."
        action={<Button onClick={() => setShowCreate(!showCreate)}>Add manual grant</Button>}
      />

      <div className="mb-6">
        <OrgSwitcher />
      </div>

      {showCreate && selectedOrgId && (
        <Card className="mb-6 p-4">
          <h3 className="font-semibold mb-3">Grant Capacity</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Admin override: manually grants meeting-hour capacity to an organization. Normal capacity comes from fulfilled orders. Grants are consumed per-provisioned-meeting, picked earliest-expiry-first.
          </p>
          <div className="grid grid-cols-2 gap-4 max-w-md mb-4">
            <div>
              <Label>Hours to Grant</Label>
              <Input type="number" value={hours} onChange={(e) => setHours(Number(e.target.value))} min={1} max={10000} />
              <p className="text-xs text-muted-foreground mt-1">{hours * 60} minutes total</p>
            </div>
            <div>
              <Label>Valid for (days)</Label>
              <Input type="number" value={validityDays} onChange={(e) => setValidityDays(Number(e.target.value))} min={1} max={3650} />
              <p className="text-xs text-muted-foreground mt-1">Expires {formatDate(expiryDate.toISOString())}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createGrant} disabled={!hours || !validityDays || saving}>
              {saving ? 'Granting...' : 'Grant Capacity'}
            </Button>
          </div>
        </Card>
      )}

      {selectedOrgId ? (
        <>
          {/* Summary */}
          {grants.length > 0 && (
            <Card className="mb-6 p-4">
              <div className="grid grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold">{totalRemainingHours.toFixed(1)}h</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Remaining</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{totalGrantedHours.toFixed(1)}h</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Granted</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{activeGrants.length}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Active Grants</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{grants.length}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Grants</div>
                </div>
              </div>
              {unboundedGrants.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Excludes {unboundedGrants.length} unbounded grant
                  {unboundedGrants.length === 1 ? '' : 's'} (no minute limit), which are shown as
                  “Unlimited” in the table below.
                </p>
              )}
            </Card>
          )}

          <Card>
            {grantsQuery.isLoading ? (
              <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : grants.length === 0 ? (
              <EmptyState
                title="No capacity grants yet"
                hint="Without an active grant, meeting provisioning fails. Grants normally come from fulfilled orders."
                action={<Button onClick={() => setShowCreate(true)}>Add manual grant</Button>}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Hours Used / Granted</TableHead>
                    <TableHead>Valid From</TableHead>
                    <TableHead>Valid Until</TableHead>
                      <TableHead>Source / Product</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grants.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell>
                        <GrantStatusBadge grant={g} />
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{g.grantedMinutes < 0 ? `${toHours(g.consumedMinutes).toFixed(1)}h / Unlimited` : `${toHours(g.consumedMinutes).toFixed(1)}h / ${toHours(g.grantedMinutes).toFixed(1)}h`}</div>
                        <div className="w-40 h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              usagePct(g) >= 100 || g.exhausted ? 'bg-red-500' :
                              usagePct(g) > 75 ? 'bg-orange-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(usagePct(g), 100)}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-sm" title={formatDateTime(g.validFrom)}>{formatRelative(g.validFrom)}</TableCell>
                      <TableCell className={`text-sm ${isExpired(g) ? 'text-red-500' : ''}`} title={formatDateTime(g.validUntil)}>
                        {formatRelative(g.validUntil)}
                      </TableCell>
                      <TableCell>
                        {g.orderId ? (
                          <div>
                            <span className="text-sm">Order #{g.orderId}</span>
                            {g.productVariantId && <div className="text-xs text-muted-foreground">Variant: {g.productVariantId}</div>}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Manual grant</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      ) : (
        <Card>
          <EmptyState
            title="Select an organization"
            hint="Capacity data is scoped per organization. Choose one above to continue."
          />
        </Card>
      )}
    </div>
  );
}
