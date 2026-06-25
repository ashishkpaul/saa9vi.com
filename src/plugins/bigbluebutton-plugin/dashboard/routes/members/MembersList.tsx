import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useDebounce } from '@uidotdev/usehooks';
import { useEffect, useState } from 'react';

const GET_ORGS = `
  query GetBbbOrganizationsForStaff {
    bbbOrganizations { items { id name slug } totalItems }
  }
`;

const GET_MEMBERS = `
  query GetBbbOrganizationStaff($organizationId: ID!, $options: BbbOrganizationMemberListOptions) {
    bbbOrganizationMembers(organizationId: $organizationId, options: $options) {
      items { id customerId customerName customerEmail role active createdAt updatedAt }
      totalItems
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

const ADD_MEMBER = `
  mutation AddBbbStaffMember($input: AddBbbMemberInput!) {
    addBbbMember(input: $input) { id customerId role active }
  }
`;

const UPDATE_MEMBER = `
  mutation UpdateBbbStaffMember($id: ID!, $input: UpdateBbbMemberInput!) {
    updateBbbMember(id: $id, input: $input) { id customerId role active }
  }
`;

const REMOVE_MEMBER = `
  mutation RemoveBbbStaffMember($id: ID!) {
    removeBbbMember(id: $id) { id active }
  }
`;

interface Member { id: string; customerId: string; customerName?: string; customerEmail?: string; role: string; active: boolean; }

export function MembersList() {
  const qc = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedSearch = useDebounce(customerSearch, 300);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [newRole, setNewRole] = useState('trainer');

  const orgsQuery = useQuery<any>({ queryKey: ['bbbOrgsForMembers'], queryFn: () => api.query(GET_ORGS) });
  const organizations = orgsQuery.data?.bbbOrganizations?.items ?? [];

  const membersQuery = useQuery<{ bbbOrganizationMembers: { items: Member[]; totalItems: number } }>({
    queryKey: ['bbbMembers', selectedOrgId],
    queryFn: () => api.query(GET_MEMBERS, { organizationId: selectedOrgId, options: {} }),
    enabled: !!selectedOrgId,
  });
  const members = membersQuery.data?.bbbOrganizationMembers?.items ?? [];

  const addMutation = useMutation({
    mutationFn: (input: any) => api.mutate(ADD_MEMBER, { input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bbbMembers'] }); toast.success('Staff member added'); setSelectedCustomer(null); setCustomerSearch(''); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: any) => api.mutate(UPDATE_MEMBER, { id, input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bbbMembers'] }); toast.success('Updated'); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.mutate(REMOVE_MEMBER, { id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bbbMembers'] }); toast.success('Staff member removed'); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  useEffect(() => {
    if (organizations.length > 0 && !selectedOrgId) {
      setSelectedOrgId(organizations[0].id);
    }
  }, [organizations]);

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
      <h1 className="text-2xl font-bold mb-4">Organization Staff</h1>
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
            <h3 className="font-semibold mb-3">Add Staff Member</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Organization memberships are for administrators and trainers only. Students gain access through course purchases (see Enrollments).
            </p>
            <div className="grid grid-cols-3 gap-4 items-end">
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
                <Label>Role</Label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trainer">trainer</SelectItem>
                    <SelectItem value="org-admin">org-admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => addMutation.mutate({ organizationId: selectedOrgId, customerId: selectedCustomer.id, role: newRole })} disabled={!selectedCustomer || addMutation.isPending}>
                {addMutation.isPending ? 'Adding...' : 'Add Staff Member'}
              </Button>
            </div>
          </Card>

          <Card>
            {membersQuery.isLoading ? (
              <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : members.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">No staff members found</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{m.customerName || '—'}</TableCell>
                      <TableCell>{m.customerEmail || '—'}</TableCell>
                      <TableCell>
                        <Select value={m.role} onValueChange={(v) => updateMutation.mutate({ id: m.id, input: { role: v } })}>
                          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="trainer">trainer</SelectItem>
                            <SelectItem value="org-admin">org-admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.active ? 'success' : 'warning'}>{m.active ? 'Active' : 'Inactive'}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => updateMutation.mutate({ id: m.id, input: { active: !m.active } })}>
                            {m.active ? 'Deactivate' : 'Activate'}
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