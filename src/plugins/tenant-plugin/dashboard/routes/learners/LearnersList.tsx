import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton, Textarea } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { graphql } from '@/gql';
import { GraduationCapIcon } from 'lucide-react';

const GET_LEARNERS = graphql(`
  query GetTenantLearners {
    tenantLearners {
      items { id customerId channelId status admissionType lastActivityAt joinedAt invitedAt }
      totalItems
    }
  }
`);

const ADMIT_LEARNER = graphql(`
  mutation AdmitTenantLearner($input: AdmitTenantLearnerInput!) {
    admitTenantLearner(input: $input) { id status admissionType }
  }
`);

const ACTIVATE_LEARNER = graphql(`
  mutation ActivateTenantLearner($customerId: ID!) {
    activateTenantLearner(customerId: $customerId) { id status }
  }
`);

const SUSPEND_LEARNER = graphql(`
  mutation SuspendTenantLearner($input: SuspendTenantLearnerInput!) {
    suspendTenantLearner(input: $input) { id status }
  }
`);

const REVOKE_LEARNER = graphql(`
  mutation RevokeTenantLearner($input: RevokeTenantLearnerInput!) {
    revokeTenantLearner(input: $input) { id status }
  }
`);

const READMIT_LEARNER = graphql(`
  mutation ReadmitTenantLearner($input: ReadmitTenantLearnerInput!) {
    readmitTenantLearner(input: $input) { id status }
  }
`);

export function LearnersList() {
  const queryClient = useQueryClient();
  const [showAdmit, setShowAdmit] = useState(false);
  const [admitCustomerId, setAdmitCustomerId] = useState('');
  const [admitType, setAdmitType] = useState('REGULAR');
  const [suspendCustomerId, setSuspendCustomerId] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['tenantLearners'],
    queryFn: () => api.query(GET_LEARNERS, {}),
  });

  const admitMutation = useMutation({
    mutationFn: (input: { customerId: string; admissionType?: string }) =>
      api.mutate(ADMIT_LEARNER, { input }),
    onSuccess: () => {
      toast.success('Learner admitted');
      setShowAdmit(false);
      setAdmitCustomerId('');
      queryClient.invalidateQueries({ queryKey: ['tenantLearners'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to admit'),
  });

  const activateMutation = useMutation({
    mutationFn: (customerId: string) => api.mutate(ACTIVATE_LEARNER, { customerId }),
    onSuccess: () => {
      toast.success('Learner activated');
      queryClient.invalidateQueries({ queryKey: ['tenantLearners'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to activate'),
  });

  const suspendMutation = useMutation({
    mutationFn: (input: { customerId: string; reason: string }) =>
      api.mutate(SUSPEND_LEARNER, { input }),
    onSuccess: () => {
      toast.success('Learner suspended');
      setSuspendCustomerId(null);
      setSuspendReason('');
      queryClient.invalidateQueries({ queryKey: ['tenantLearners'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to suspend'),
  });

  const revokeMutation = useMutation({
    mutationFn: (input: { customerId: string; reason?: string }) =>
      api.mutate(REVOKE_LEARNER, { input }),
    onSuccess: () => {
      toast.success('Learner revoked');
      queryClient.invalidateQueries({ queryKey: ['tenantLearners'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to revoke'),
  });

  const readmitMutation = useMutation({
    mutationFn: (input: { customerId: string; reason?: string }) =>
      api.mutate(READMIT_LEARNER, { input }),
    onSuccess: () => {
      toast.success('Learner re-admitted');
      queryClient.invalidateQueries({ queryKey: ['tenantLearners'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to re-admit'),
  });

  const statusBadge = (status: string) => {
    const variant = status === 'ACTIVE' ? 'success' : status === 'SUSPENDED' ? 'warning' : status === 'REVOKED' || status === 'LEFT' ? 'destructive' : 'outline';
    return <Badge variant={variant as any}>{status}</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Learners</h1>
        <Dialog open={showAdmit} onOpenChange={setShowAdmit}>
          <DialogTrigger asChild>
            <Button>Admit Learner</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Admit New Learner</DialogTitle>
              <DialogDescription>Enter the customer ID and admission type.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="customerId">Customer ID</Label>
                <Input id="customerId" value={admitCustomerId} onChange={(e) => setAdmitCustomerId(e.target.value)} placeholder="123" />
              </div>
              <div>
                <Label htmlFor="admissionType">Admission Type</Label>
                <select id="admissionType" value={admitType} onChange={(e) => setAdmitType(e.target.value)} className="w-full border rounded px-3 py-2">
                  <option value="REGULAR">Regular</option>
                  <option value="SCHOLARSHIP">Scholarship</option>
                  <option value="DEMO">Demo</option>
                  <option value="COMPLIMENTARY">Complimentary</option>
                  <option value="CORPORATE">Corporate</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAdmit(false)}>Cancel</Button>
              <Button
                disabled={!admitCustomerId}
                onClick={() => admitMutation.mutate({ customerId: admitCustomerId, admissionType: admitType })}
              >
                Admit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Admission Type</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.tenantLearners?.items?.map((learner: any) => (
                <TableRow key={learner.id}>
                  <TableCell className="font-mono text-sm">{learner.customerId}</TableCell>
                  <TableCell>{statusBadge(learner.status)}</TableCell>
                  <TableCell>{learner.admissionType}</TableCell>
                  <TableCell>{learner.joinedAt ? new Date(learner.joinedAt).toLocaleDateString() : '—'}</TableCell>
                  <TableCell>{learner.lastActivityAt ? new Date(learner.lastActivityAt).toLocaleDateString() : '—'}</TableCell>
                  <TableCell className="space-x-1">
                    {learner.status === 'PENDING' && (
                      <Button size="sm" variant="outline" onClick={() => activateMutation.mutate(learner.customerId)}>
                        Activate
                      </Button>
                    )}
                    {learner.status === 'ACTIVE' && (
                      <Button size="sm" variant="outline" onClick={() => setSuspendCustomerId(learner.customerId)}>
                        Suspend
                      </Button>
                    )}
                    {(learner.status === 'ACTIVE' || learner.status === 'SUSPENDED') && (
                      <Button size="sm" variant="outline" onClick={() => revokeMutation.mutate({ customerId: learner.customerId })}>
                        Revoke
                      </Button>
                    )}
                    {(learner.status === 'LEFT' || learner.status === 'REVOKED') && (
                      <Button size="sm" variant="outline" onClick={() => readmitMutation.mutate({ customerId: learner.customerId })}>
                        Re-admit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data?.tenantLearners?.items?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No learners yet. Admit your first learner.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Suspend dialog with reason */}
      <Dialog open={suspendCustomerId !== null} onOpenChange={(open) => !open && setSuspendCustomerId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend Learner</DialogTitle>
            <DialogDescription>Provide a reason for the suspension.</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} rows={3} placeholder="Reason for suspension..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendCustomerId(null)}>Cancel</Button>
            <Button
              disabled={!suspendReason}
              variant="destructive"
              onClick={() => suspendCustomerId && suspendMutation.mutate({ customerId: suspendCustomerId, reason: suspendReason })}
            >
              Suspend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
