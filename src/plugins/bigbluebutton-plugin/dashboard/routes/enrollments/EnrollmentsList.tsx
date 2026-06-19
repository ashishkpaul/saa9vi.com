import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useDebounce } from '@uidotdev/usehooks';
import { useEffect, useState } from 'react';

const GET_ORGS = `
  query GetBbbOrgsForEnrollments {
    bbbOrganizations { items { id name slug } }
  }
`;

const GET_ROOMS = `
  query GetBbbRoomsForEnrollments($organizationId: ID!) {
    bbbRooms(organizationId: $organizationId) { items { id name state } }
  }
`;

const GET_PRODUCT_ACCESS = `
  query GetBbbProductAccess($roomId: ID!) {
    bbbProductAccessByRoom(roomId: $roomId) { id productVariantId accessDays }
  }
`;

const GET_ENROLLMENTS = `
  query GetBbbEnrollmentsByRoom($roomId: ID!, $options: BbbEnrollmentListOptions) {
    bbbEnrollmentsByRoom(roomId: $roomId, options: $options) {
      items { id customerId customerName customerEmail active expiresAt validFrom validUntil source createdAt }
      totalItems
    }
  }
`;

const SEARCH_VARIANTS = `
  query BbbProductVariantSearch($term: String!) {
    bbbProductVariantSearch(term: $term) { id name sku productName }
  }
`;

const SEARCH_CUSTOMERS = `
  query SearchCustomersForEnrollment($term: String!) {
    customers(options: { filter: { emailAddress: { contains: $term } }, take: 10 }) {
      items { id firstName lastName emailAddress }
    }
  }
`;

const CREATE_PRODUCT_ACCESS = `
  mutation CreateBbbProductAccess($input: CreateBbbProductAccessInput!) {
    createBbbProductAccess(input: $input) { id productVariantId accessDays }
  }
`;

const DELETE_PRODUCT_ACCESS = `
  mutation DeleteBbbProductAccess($id: ID!) { deleteBbbProductAccess(id: $id) }
`;

const CREATE_ENROLLMENT = `
  mutation CreateBbbEnrollment($input: CreateBbbEnrollmentInput!) {
    createBbbEnrollment(input: $input) { id customerId active source }
  }
`;

const DEACTIVATE_ENROLLMENT = `
  mutation DeactivateBbbEnrollment($id: ID!) {
    deactivateBbbEnrollment(id: $id) { id active }
  }
`;

export function EnrollmentsList() {
  const qc = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Variant search
  const [variantTerm, setVariantTerm] = useState('');
  const debouncedVariantTerm = useDebounce(variantTerm, 300);
  const [variantResults, setVariantResults] = useState<any[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<any>(null);
  const [accessDays, setAccessDays] = useState<number | null>(null);

  // Customer search
  const [customerTerm, setCustomerTerm] = useState('');
  const debouncedCustomerTerm = useDebounce(customerTerm, 300);
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [enrollAccessDays, setEnrollAccessDays] = useState<number | null>(null);

  const orgsQuery = useQuery<any>({ queryKey: ['bbbOrgsForEnroll'], queryFn: () => api.query(GET_ORGS) });
  const organizations = orgsQuery.data?.bbbOrganizations?.items ?? [];

  const roomsQuery = useQuery<any>({
    queryKey: ['bbbRoomsForEnroll', selectedOrgId],
    queryFn: () => api.query(GET_ROOMS, { organizationId: selectedOrgId }),
    enabled: !!selectedOrgId,
  });
  const rooms = roomsQuery.data?.bbbRooms?.items ?? [];

  const productAccessQuery = useQuery<any>({
    queryKey: ['bbbProductAccess', selectedRoomId],
    queryFn: () => api.query(GET_PRODUCT_ACCESS, { roomId: selectedRoomId }),
    enabled: !!selectedRoomId,
  });
  const productAccess = productAccessQuery.data?.bbbProductAccessByRoom ?? [];

  const enrollQuery = useQuery<any>({
    queryKey: ['bbbEnrollments', selectedRoomId, page],
    queryFn: () => api.query(GET_ENROLLMENTS, { roomId: selectedRoomId, options: { skip: (page - 1) * pageSize, take: pageSize } }),
    enabled: !!selectedRoomId,
    placeholderData: (prev: any) => prev as any,
  });
  const enrollments = enrollQuery.data?.bbbEnrollmentsByRoom?.items ?? [];
  const totalItems = enrollQuery.data?.bbbEnrollmentsByRoom?.totalItems ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const activeCount = enrollments.filter((e: any) => isActive(e)).length;

  function isActive(e: any) {
    if (!e.active) return false;
    const now = new Date();
    if (e.validUntil && new Date(e.validUntil) < now) return false;
    if (!e.validUntil && e.expiresAt && new Date(e.expiresAt) < now) return false;
    return true;
  }

  useEffect(() => {
    let cancelled = false;
    async function runVariantSearch() {
      setSelectedVariant(null);
      if (debouncedVariantTerm.length < 2) { setVariantResults([]); return; }
      const res = await api.query<{ bbbProductVariantSearch: any[] }>(SEARCH_VARIANTS, { term: debouncedVariantTerm });
      if (!cancelled) setVariantResults(res?.bbbProductVariantSearch ?? []);
    }
    runVariantSearch();
    return () => { cancelled = true; };
  }, [debouncedVariantTerm]);

  useEffect(() => {
    let cancelled = false;
    async function runCustomerSearch() {
      setSelectedCustomer(null);
      if (debouncedCustomerTerm.length < 2) { setCustomerResults([]); return; }
      const res = await api.query<{ customers: { items: any[] } }>(SEARCH_CUSTOMERS, { term: debouncedCustomerTerm });
      if (!cancelled) setCustomerResults(res?.customers?.items ?? []);
    }
    runCustomerSearch();
    return () => { cancelled = true; };
  }, [debouncedCustomerTerm]);

  const addProductAccessMutation = useMutation({
    mutationFn: (input: any) => api.mutate(CREATE_PRODUCT_ACCESS, { input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bbbProductAccess'] }); toast.success('Mapping added'); setSelectedVariant(null); setVariantTerm(''); setAccessDays(null); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const deleteProductAccessMutation = useMutation({
    mutationFn: (id: string) => api.mutate(DELETE_PRODUCT_ACCESS, { id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bbbProductAccess'] }); toast.success('Mapping removed'); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const addEnrollmentMutation = useMutation({
    mutationFn: (input: any) => api.mutate(CREATE_ENROLLMENT, { input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bbbEnrollments'] }); toast.success('Enrollment created'); setSelectedCustomer(null); setCustomerTerm(''); setEnrollAccessDays(null); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.mutate(DEACTIVATE_ENROLLMENT, { id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bbbEnrollments'] }); toast.success('Enrollment revoked'); },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Enrollments</h1>

      {/* Organization Picker */}
      <div className="max-w-xs mb-4">
        <Label>Organization</Label>
        <Select value={selectedOrgId} onValueChange={(v: string) => { setSelectedOrgId(v); setSelectedRoomId(''); }}>
          <SelectTrigger><SelectValue placeholder="-- Select organization --" /></SelectTrigger>
          <SelectContent>
            {organizations.map((o: any) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selectedOrgId && (
        <div className="max-w-xs mb-6">
          <Label>Room</Label>
          <Select value={selectedRoomId} onValueChange={(v: string) => { setSelectedRoomId(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="-- Select room --" /></SelectTrigger>
            <SelectContent>
              {rooms.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name} ({r.state})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {selectedRoomId && (
        <>
          {/* Product Access Section */}
          <Card className="mb-6 p-4">
            <h3 className="font-semibold mb-2">Product Mappings</h3>
            <p className="text-sm text-muted-foreground mb-3">Customers who purchase these products are automatically enrolled in this room.</p>

            {productAccess.length > 0 ? (
              <div className="border rounded mb-3">
                {productAccess.map((pa: any) => (
                  <div key={pa.id} className="flex items-center justify-between px-3 py-2 border-b last:border-b-0">
                    <span className="text-sm"><code>{pa.productVariantId}</code> {pa.accessDays ? `— ${pa.accessDays} days` : '— Unlimited'}</span>
                    <Button variant="destructive" size="sm" onClick={() => deleteProductAccessMutation.mutate(pa.id)}>Remove</Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-3">No products mapped yet.</p>
            )}

            <div className="grid grid-cols-3 gap-4 items-end">
              <div>
                <Label>Product / Variant</Label>
                <Input value={variantTerm} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVariantTerm(e.target.value)} placeholder={selectedVariant ? `${selectedVariant.productName} — ${selectedVariant.name}` : 'Search by name or SKU...'} />
                {variantResults.length > 0 && !selectedVariant && (
                  <div className="border rounded mt-1 max-h-32 overflow-y-auto">
                    {variantResults.map((v: any) => (
                      <div key={v.id} className="p-2 cursor-pointer hover:bg-accent text-sm" onClick={() => { setSelectedVariant(v as any); setVariantResults([]); }}>
                        <div className="font-medium">{v.productName}</div>
                        <div className="text-xs text-muted-foreground">{v.name} <code>{v.sku}</code></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <Label>Access Days (blank = unlimited)</Label>
                <Input type="number" value={accessDays ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAccessDays(e.target.value ? Number(e.target.value) : null)} placeholder="30" />
              </div>
              <Button onClick={() => addProductAccessMutation.mutate({ roomId: selectedRoomId, productVariantId: selectedVariant.id, accessDays: accessDays || null })} disabled={!selectedVariant || addProductAccessMutation.isPending}>
                Add Mapping
              </Button>
            </div>
          </Card>

          {/* Manual Enrollment */}
          <Card className="mb-6 p-4">
            <h3 className="font-semibold mb-2">Add Enrollment</h3>
            <p className="text-sm text-muted-foreground mb-3">Manually enroll a customer (e.g. scholarship, demo). Source is recorded as <code>admin</code>.</p>
            <div className="grid grid-cols-3 gap-4 items-end">
              <div>
                <Label>Customer</Label>
                <Input value={customerTerm} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomerTerm(e.target.value)} placeholder={selectedCustomer ? selectedCustomer.emailAddress : 'Search by email...'} />
                {customerResults.length > 0 && !selectedCustomer && (
                  <div className="border rounded mt-1 max-h-32 overflow-y-auto">
                    {customerResults.map((c: any) => (
                      <div key={c.id} className="p-2 cursor-pointer hover:bg-accent text-sm" onClick={() => { setSelectedCustomer(c); setCustomerResults([]); }}>
                        <div className="font-medium">{c.firstName} {c.lastName}</div>
                        <div className="text-xs text-muted-foreground">{c.emailAddress}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <Label>Access Days (blank = unlimited)</Label>
                <Input type="number" value={enrollAccessDays ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEnrollAccessDays(e.target.value ? Number(e.target.value) : null)} placeholder="30" />
              </div>
              <Button onClick={() => addEnrollmentMutation.mutate({ roomId: selectedRoomId, customerId: selectedCustomer.id, accessDays: enrollAccessDays || null })} disabled={!selectedCustomer || addEnrollmentMutation.isPending}>
                Enroll
              </Button>
            </div>
          </Card>

          {/* Enrollment Table */}
          <Card>
            <div className="p-4 border-b flex gap-4">
              <Badge variant="success">Active: {activeCount}</Badge>
              <Badge variant="warning">Expired/Inactive: {totalItems - activeCount}</Badge>
            </div>
            {enrollQuery.isLoading ? (
              <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : enrollments.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">No enrollments yet.</div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Enrolled</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrollments.map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell>{e.customerName || '—'}</TableCell>
                        <TableCell>{e.customerEmail || '—'}</TableCell>
                        <TableCell><Badge>{e.source}</Badge></TableCell>
                        <TableCell>
                          <Badge variant={isActive(e) ? 'success' : 'warning'}>{isActive(e) ? 'Active' : 'Expired/Inactive'}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{e.validUntil || e.expiresAt ? new Date(e.validUntil || e.expiresAt).toLocaleDateString() : 'Never'}</TableCell>
                        <TableCell className="text-sm">{new Date(e.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          {e.active && <Button variant="destructive" size="sm" onClick={() => deactivateMutation.mutate(e.id)}>Revoke</Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <div className="text-sm text-muted-foreground">{totalItems} total</div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
                    <span className="text-sm">Page {page} of {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}