import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';

const GET_ORGS = `
  query GetBbbOrgsForPlans {
    bbbOrganizations { items { id name slug } }
  }
`;

const GET_GRANTS = `
  query GetBbbCapacityGrants($organizationId: ID!) {
    bbbCapacityGrants(organizationId: $organizationId) {
      id grantedMinutes consumedMinutes validFrom validUntil exhausted orderId orderLineId productVariantId
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

export function PlansList() {
  const qc = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [hours, setHours] = useState(10);
  const [validityDays, setValidityDays] = useState(30);
  const [saving, setSaving] = useState(false);

  const orgsQuery = useQuery<any>({
    queryKey: ['bbbOrgsForPlans'],
    queryFn: () => api.query(GET_ORGS),
    staleTime: 5 * 60 * 1000, // 5 min — orgs don't change frequently
  });
  const organizations = orgsQuery.data?.bbbOrganizations?.items ?? [];

  // Select first org by default — depend on query data, not derived array,
  // to avoid stale closures when data arrives after initial mount
  useEffect(() => {
    const items = orgsQuery.data?.bbbOrganizations?.items ?? [];
    if (!selectedOrgId && items.length > 0) {
      setSelectedOrgId(items[0].id);
    }
  }, [orgsQuery.data, selectedOrgId]);

  const grantsQuery = useQuery<{ bbbCapacityGrants: Grant[] }>({
    queryKey: ['bbbGrants', selectedOrgId],
    queryFn: () => api.query(GET_GRANTS, { organizationId: selectedOrgId }),
    enabled: !!selectedOrgId,
  });
  const grants = grantsQuery.data?.bbbCapacityGrants ?? [];

  function isActive(g: Grant) {
    if (g.exhausted) return false;
    const now = new Date();
    return new Date(g.validFrom) <= now && new Date(g.validUntil) >= now;
  }

  function isExpired(g: Grant) {
    return new Date(g.validUntil) < new Date();
  }

  function toHours(minutes: number) { return (minutes ?? 0) / 60; }

  function usagePct(g: Grant) {
    if (!g.grantedMinutes) return 0;
    return Math.min(100, Math.round(((g.consumedMinutes ?? 0) / g.grantedMinutes) * 100));
  }

  const activeGrants = grants.filter(g => isActive(g));
  const totalGrantedHours = activeGrants.reduce((s, g) => s + toHours(g.grantedMinutes), 0);
  const totalRemainingHours = activeGrants.reduce((s, g) => s + toHours((g.grantedMinutes ?? 0) - (g.consumedMinutes ?? 0)), 0);

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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Capacity Grants</h1>
        <Button onClick={() => setShowCreate(!showCreate)}>Grant Capacity (Admin Override)</Button>
      </div>

      <div className="max-w-xs mb-6">
        <Label>Organization</Label>
        <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
          <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
          <SelectContent>
            {organizations.map((o: any) => <SelectItem key={o.id} value={o.id}>{o.name} ({o.slug})</SelectItem>)}
          </SelectContent>
        </Select>
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
              <p className="text-xs text-muted-foreground mt-1">Expires {expiryDate.toLocaleDateString()}</p>
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

      {selectedOrgId && (
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
            </Card>
          )}

          <Card>
            {grantsQuery.isLoading ? (
              <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : grants.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-muted-foreground mb-4">No capacity grants yet for this organization.</p>
                <p className="text-sm text-muted-foreground mb-4">Capacity grants allocate meeting-hour capacity. Without an active grant, meeting provisioning will fail. Grants are normally created via fulfilled orders.</p>
                <Button onClick={() => setShowCreate(true)}>Grant First Capacity (Admin Override)</Button>
              </div>
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
                        {isActive(g) && <Badge variant="success">Active</Badge>}
                        {g.exhausted && <Badge variant="destructive">Exhausted</Badge>}
                        {isExpired(g) && !g.exhausted && <Badge variant="warning">Expired</Badge>}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{toHours(g.consumedMinutes).toFixed(1)}h / {toHours(g.grantedMinutes).toFixed(1)}h</div>
                        <div className="w-40 h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              usagePct(g) > 75 ? 'bg-orange-500' :
                              usagePct(g) >= 100 || g.exhausted ? 'bg-red-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(usagePct(g), 100)}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{new Date(g.validFrom).toLocaleDateString()}</TableCell>
                      <TableCell className={`text-sm ${isExpired(g) ? 'text-red-500' : ''}`}>
                        {new Date(g.validUntil).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {g.orderId ? (
                          <div>
                            <span className="text-sm">Order #{g.orderId}</span>
                            {g.productVariantId && <div className="text-xs text-muted-foreground">Variant: {g.productVariantId}</div>}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Admin Override</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}