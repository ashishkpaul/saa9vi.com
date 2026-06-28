import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useDebounce } from '@uidotdev/usehooks';
import { useEffect, useState } from 'react';

const GET_ORGS = `
  query GetBbbOrganizationsForMemberships {
    bbbOrganizations { items { id name slug channelId } totalItems }
  }
`;

const GET_MEMBERSHIPS = `
  query GetBbbOrgMemberships($organizationId: ID!) {
    bbbOrgMemberships(organizationId: $organizationId) {
      id customerId channelId role isActive createdAt updatedAt
    }
  }
`;

const SEARCH_CUSTOMERS = `
  query SearchCustomersForBbb($term: String!) {
    customers(options: { filter: { emailAddress: { contains: $term } }, take: 10 }) {
      items { id firstName lastName emailAddress }
    }
  }
`;

const CREATE_MEMBERSHIP = `
  mutation CreateBbbOrgMembership($input: CreateBbbOrgMembershipInput!) {
    createBbbOrgMembership(input: $input) { id customerId role isActive }
  }
`;

const UPDATE_MEMBERSHIP = `
  mutation UpdateBbbOrgMembership($id: ID!, $input: UpdateBbbOrgMembershipInput!) {
    updateBbbOrgMembership(id: $id, input: $input) { id customerId role isActive }
  }
`;

const REMOVE_MEMBERSHIP = `
  mutation RemoveBbbOrgMembership($id: ID!) {
    removeBbbOrgMembership(id: $id)
  }
`;

interface Membership { id: string; customerId: string; channelId: string; role: string; isActive: boolean; createdAt: string; updatedAt: string; }

export function MembershipsList() {
  const qc = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedSearch = useDebounce(customerSearch, 300);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [newRole, setNewRole] = useState('staff');
  const [newChannelId, setNewChannelId] = useState('');

  const orgsQuery = useQuery<any>({ queryKey: ['bbbOrgsForMemberships'], queryFn: () => api.query(GET_ORGS) });
  const organizations = orgsQuery.data?.bbbOrganizations?.items ?? [];

  const membershipsQuery = useQuery<{ bbbOrgMemberships: Membership[] }>({
    queryKey: ['bbbMemberships', selectedOrgId],
    queryFn: () => api.query(GET_MEMBERSHIPS, { organizationId: selectedOrgId }),
    enabled: !!selectedOrgId,
  });
  const memberships = membershipsQuery.data?.bbbOrgMemberships ?? [];

  const createMutation = useMutation({
    mutationFn: (input: any) => api.mutate(CREATE_MEMBERSHIP, { input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bbbMemberships'] }); toast.success('Membership created'); setSelectedCustomer(null); setCustomerSearch(''); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: any) => api.mutate(UPDATE_MEMBERSHIP, { id, input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bbbMemberships'] }); toast.success('Updated'); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.mutate(REMOVE_MEMBERSHIP, { id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bbbMemberships'] }); toast.success('Membership removed'); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  useEffect(() => {
    if (organizations.length > 0 && !selectedOrgId) {
      setSelectedOrgId(organizations[0].id);
      setNewChannelId(organizations[0].channelId);
    }
  }, [organizations]);

  useEffect(() => {
    if (!selectedOrgId) return;
    const org = organizations.find((o: any) => o.id === selectedOrgId);
    if (org) setNewChannelId(org.channelId);
  }, [selectedOrgId]);

  useEffect(() => {
    let cancelled = false;
    async function runSearch() {
      setSelectedCustomer(null);
      if (debouncedSearch.length < 2) { setCustomers([]); return; }
      const res = await api.query<{ customers: { items: any[] } }>(SEARCH_CUSTOMERS, { term: debouncedSearch });
      if (!cancelled) setCustomers(res?.customers?.items ?? []);
    }
    runSearch();
    return () => { cancelled = true; };
  }, [debouncedSearch]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Organization Memberships</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Internal staff memberships for Archetype B (Internal Staff Meeting flow).
        Staff with active memberships can join internal rooms (productVariantId = null)
        without purchasing a plan.
      </p>

      <div className="max-w-xs mb-6">
        <Label>Organization</Label>
        <Select value={selectedOrgId} onValueChange={(v) => { setSelectedOrgId(v); }}>
          <SelectTrigger><SelectValue placeholder="-- Select organization --" /></SelectTrigger>
          <SelectContent>
            {organizations.map((o: any) => <SelectItem key={o.id} value={o.id}>{o.name} ({o.slug})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selectedOrgId && (
        <>
          <Card className="mb-6 p-4">
            <h3 className="font-semibold mb-3">Add Staff Membership</h3>
            <div className="grid grid-cols-4 gap-4 items-end">
              <div>
                <Label>Search Customer</Label>
                <Input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder={selectedCustomer ? selectedCustomer.emailAddress : 'Search by email...'}
                />
                {customers.length > 0 && !selectedCustomer && (
                  <div className="border rounded mt-1 max-h-40 overflow-y-auto">
                    {customers.map((c: any) => (
                      <div key={c.id} className="p-2 cursor-pointer hover:bg-accent text-sm" onClick={() => { setSelectedCustomer(c); setCustomers([]); }}>
                        <div className="font-medium">{c.firstName} {c.lastName}</div>
                        <div className="text-xs text-muted-foreground">{c.emailAddress}</div>
                      </div>
                    ))}
                  </div>
                )}
                {selectedCustomer && (
                  <div className="text-sm mt-1 p-1 bg-muted rounded flex items-center justify-between">
                    <span>{selectedCustomer.firstName} {selectedCustomer.lastName} — {selectedCustomer.emailAddress}</span>
                    <Button variant="ghost" size="sm" onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }}>✕</Button>
                  </div>
                )}
              </div>
              <div>
                <Label>Channel ID</Label>
                <Input value={newChannelId} onChange={(e) => setNewChannelId(e.target.value)} placeholder="channel-id" />
              </div>
              <div>
                <Label>Role</Label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="org_admin">org_admin</SelectItem>
                    <SelectItem value="moderator">moderator</SelectItem>
                    <SelectItem value="staff">staff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => createMutation.mutate({ organizationId: selectedOrgId, customerId: selectedCustomer.id, channelId: newChannelId, role: newRole })} disabled={!selectedCustomer || createMutation.isPending}>
                {createMutation.isPending ? 'Adding...' : 'Add Membership'}
              </Button>
            </div>
          </Card>

          <Card>
            {membershipsQuery.isLoading ? (
              <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : memberships.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">No memberships found</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer ID</TableHead>
                    <TableHead>Channel ID</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberships.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">{m.customerId}</TableCell>
                      <TableCell className="font-mono text-xs">{m.channelId}</TableCell>
                      <TableCell>
                        <Badge variant={m.role === 'org_admin' ? 'success' : m.role === 'moderator' ? 'warning' : 'outline'}>{m.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.isActive ? 'success' : 'warning'}>{m.isActive ? 'Active' : 'Inactive'}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{new Date(m.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => updateMutation.mutate({ id: m.id, input: { isActive: !m.isActive } })}>
                            {m.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => removeMutation.mutate(m.id)}>Remove</Button>
                        </div>
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
