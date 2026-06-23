import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';

const GET_ORGS = `
  query GetOrgsForTrialRegistrations {
    bbbOrganizations { items { id name slug } totalItems }
  }
`;

const GET_TRIAL_REGISTRATIONS = `
  query GetBbbTrialRegistrations($organizationId: ID!) {
    bbbTrialRegistrationsByOrganization(organizationId: $organizationId) {
      id scheduledSessionId customerId status registeredAt attendedAt createdAt
    }
  }
`;

const UPDATE_STATUS = `
  mutation UpdateTrialRegistrationStatus($id: ID!, $status: String!) {
    updateBbbTrialRegistrationStatus(id: $id, status: $status) {
      id status attendedAt
    }
  }
`;

interface TrialRegistration {
  id: string; scheduledSessionId: string; customerId: string;
  status: string; registeredAt: string; attendedAt: string | null; createdAt: string;
}

const STATUS_BADGE: Record<string, { variant: 'success' | 'warning' | 'destructive' | 'outline'; label: string }> = {
  REGISTERED: { variant: 'outline', label: 'Registered' },
  ATTENDED: { variant: 'success', label: 'Attended' },
  CANCELLED: { variant: 'warning', label: 'Cancelled' },
  NO_SHOW: { variant: 'destructive', label: 'No Show' },
};

export function TrialRegistrationsList() {
  const qc = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState('');

  const orgsQuery = useQuery<any>({
    queryKey: ['orgsForTrials'],
    queryFn: () => api.query(GET_ORGS),
    staleTime: 5 * 60 * 1000, // 5 min — orgs don't change frequently
  });
  const organizations = orgsQuery.data?.bbbOrganizations?.items ?? [];

  // Auto-select first org — depend on query data, not derived array,
  // to avoid stale closures when data arrives after initial mount
  useEffect(() => {
    const items = orgsQuery.data?.bbbOrganizations?.items ?? [];
    if (!selectedOrgId && items.length > 0) {
      setSelectedOrgId(items[0].id);
    }
  }, [orgsQuery.data, selectedOrgId]);

  const registrationsQuery = useQuery<{ bbbTrialRegistrationsByOrganization: TrialRegistration[] }>({
    queryKey: ['trialRegistrations', selectedOrgId],
    queryFn: () => api.query(GET_TRIAL_REGISTRATIONS, { organizationId: selectedOrgId }),
    enabled: !!selectedOrgId,
  });
  const registrations = registrationsQuery.data?.bbbTrialRegistrationsByOrganization ?? [];

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.mutate(UPDATE_STATUS, { id, status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trialRegistrations'] });
      toast.success('Registration status updated');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Trial Registrations</h1>
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

      <Card>
        {registrationsQuery.isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !selectedOrgId ? (
          <div className="p-6 text-center text-muted-foreground">Select an organization to view trial registrations</div>
        ) : registrations.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-muted-foreground">No trial registrations found for this organization.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer ID</TableHead>
                <TableHead>Session ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Registered At</TableHead>
                <TableHead>Attended At</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registrations.map((reg) => {
                const badge = STATUS_BADGE[reg.status] ?? { variant: 'outline' as const, label: reg.status };
                return (
                  <TableRow key={reg.id}>
                    <TableCell><code className="text-xs">{reg.customerId?.substring(0, 12)}...</code></TableCell>
                    <TableCell><code className="text-xs">{reg.scheduledSessionId?.substring(0, 12)}...</code></TableCell>
                    <TableCell><Badge variant={badge.variant}>{badge.label}</Badge></TableCell>
                    <TableCell className="text-sm">{new Date(reg.registeredAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-sm">{reg.attendedAt ? new Date(reg.attendedAt).toLocaleDateString() : '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {reg.status === 'REGISTERED' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => updateStatusMutation.mutate({ id: reg.id, status: 'ATTENDED' })}>
                              Mark Attended
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => updateStatusMutation.mutate({ id: reg.id, status: 'NO_SHOW' })}>
                              No Show
                            </Button>
                          </>
                        )}
                        {reg.status === 'ATTENDED' && (
                          <span className="text-xs text-muted-foreground italic">Complete</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}