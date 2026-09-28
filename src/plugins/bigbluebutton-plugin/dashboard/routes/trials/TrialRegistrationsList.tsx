import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { graphql } from '@/gql';
import { OrgSwitcher, useBbbOrgs } from '../../shared/OrgSwitcher';
import { useSelectedOrgId } from '../../shared/orgStore';
import { PageHeader, EmptyState } from '../../shared/PageHeader';
import { TrialStatusBadge } from '../../shared/StatusBadge';
import { formatDate } from '../../shared/dates';

const GET_TRIAL_REGISTRATIONS = graphql(`
  query GetBbbTrialRegistrations($organizationId: ID!) {
    bbbTrialRegistrationsByOrganization(organizationId: $organizationId) {
      id scheduledSessionId customerId status registeredAt attendedAt createdAt
    }
  }
`);

const UPDATE_STATUS = graphql(`
  mutation UpdateTrialRegistrationStatus($id: ID!, $status: String!) {
    updateBbbTrialRegistrationStatus(id: $id, status: $status) {
      id status attendedAt
    }
  }
`);

const CONVERT_TO_ENROLLMENT = graphql(`
  mutation ConvertTrialToEnrollment($registrationId: ID!, $roomId: ID!, $accessDays: Int) {
    convertTrialToEnrollment(registrationId: $registrationId, roomId: $roomId, accessDays: $accessDays) {
      id
      type
      resourceId
      validFrom
      validUntil
    }
  }
`);

const GET_ROOMS_FOR_TRIALS = graphql(`
  query GetBbbRoomsForTrialConvert($organizationId: ID!) {
    bbbRooms(organizationId: $organizationId) { items { id name state } }
  }
`);

type TrialRegistrationRow = {
  id: string;
  scheduledSessionId: string;
  customerId: string;
  status: string;
  registeredAt: string;
  attendedAt: string | null;
  createdAt: string;
};

export function TrialRegistrationsList() {
  const qc = useQueryClient();
  const [selectedOrgId] = useSelectedOrgId();
  const [convertTargetId, setConvertTargetId] = useState<string | null>(null);
  const [convertRoomId, setConvertRoomId] = useState('');
  const [convertAccessDays, setConvertAccessDays] = useState('');

  // Shared org list (single fetch, cached 5 min) keeps the switcher warm.
  useBbbOrgs();

  const registrationsQuery = useQuery({
    queryKey: ['trialRegistrations', selectedOrgId],
    queryFn: () => api.query(GET_TRIAL_REGISTRATIONS, { organizationId: selectedOrgId }),
    enabled: !!selectedOrgId,
  });
  const registrations = registrationsQuery.data?.bbbTrialRegistrationsByOrganization ?? [];

  const roomsQuery = useQuery<any>({
    queryKey: ['bbbRoomsForTrialConvert', selectedOrgId],
    queryFn: () => api.query(GET_ROOMS_FOR_TRIALS, { organizationId: selectedOrgId }),
    enabled: !!selectedOrgId && convertTargetId !== null,
  });
  const convertRooms = roomsQuery.data?.bbbRooms?.items ?? [];

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.mutate(UPDATE_STATUS, { id, status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trialRegistrations'] });
      toast.success('Registration status updated');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  const convertMutation = useMutation({
    mutationFn: ({ registrationId, roomId, accessDays }: { registrationId: string; roomId: string; accessDays?: number }) =>
      api.mutate(CONVERT_TO_ENROLLMENT, { registrationId, roomId, accessDays }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trialRegistrations'] });
      toast.success('Trial converted to learner successfully');
    },
    onError: (err: Error) => toast.error('Conversion failed', { description: err.message }),
  });

  function openConvert(registrationId: string) {
    setConvertTargetId(registrationId);
    setConvertRoomId('');
    setConvertAccessDays('');
  }

  function handleConvertConfirm() {
    if (!convertTargetId || !convertRoomId) return;
    const accessDays = convertAccessDays.trim() === '' ? undefined : Number(convertAccessDays);
    if (accessDays !== undefined && (!Number.isFinite(accessDays) || accessDays <= 0)) {
      toast.error('Invalid access days', { description: 'Enter a positive number of days, or leave blank for unlimited.' });
      return;
    }
    convertMutation.mutate({ registrationId: convertTargetId, roomId: convertRoomId, accessDays });
    setConvertTargetId(null);
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Trials"
        description="Trial registrations for this organization. Mark attendance, then convert attended trials into learner enrollments."
      />

      <div className="mb-6">
        <OrgSwitcher />
      </div>

      <Card>
        {registrationsQuery.isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !selectedOrgId ? (
          <EmptyState title="Select an organization" hint="Trial registrations are scoped per organization. Choose one above to continue." />
        ) : registrations.length === 0 ? (
          <EmptyState title="No trial registrations yet" hint="Trial registrations appear here once students register for trial sessions." />
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
                return (
                  <TableRow key={reg.id}>
                    <TableCell><code className="text-xs">{reg.customerId?.substring(0, 12)}...</code></TableCell>
                    <TableCell><code className="text-xs">{reg.scheduledSessionId?.substring(0, 12)}...</code></TableCell>
                    <TableCell><TrialStatusBadge status={reg.status} /></TableCell>
                    <TableCell className="text-sm">{formatDate(reg.registeredAt)}</TableCell>
                    <TableCell className="text-sm">{reg.attendedAt ? formatDate(reg.attendedAt) : '—'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {reg.status === 'REGISTERED' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => updateStatusMutation.mutate({ id: String(reg.id), status: 'ATTENDED' })}>
                              Mark Attended
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => updateStatusMutation.mutate({ id: String(reg.id), status: 'NO_SHOW' })}>
                              No Show
                            </Button>
                          </>
                        )}
                        {reg.status === 'ATTENDED' && (
                          <Button size="sm" onClick={() => openConvert(String(reg.id))} disabled={convertMutation.isPending}>
                            Convert to Learner
                          </Button>
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

      <Dialog open={convertTargetId !== null} onOpenChange={(o) => !o && setConvertTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert trial to learner</DialogTitle>
            <DialogDescription>
              Enroll this learner into a room in the selected organization. The trial record is preserved for audit.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="convert-room">Room</Label>
              <Select value={convertRoomId} onValueChange={setConvertRoomId}>
                <SelectTrigger id="convert-room">
                  <SelectValue placeholder={roomsQuery.isLoading ? 'Loading rooms…' : 'Select room'}>
                    {(v) => (typeof v === 'string' && convertRooms.find((r: any) => String(r.id) === v)?.name) || undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {convertRooms.map((r: any) => (
                    <SelectItem key={r.id} value={String(r.id)}>{r.name} ({r.state})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="convert-days">Access days (optional)</Label>
              <Input
                id="convert-days"
                type="number"
                min={1}
                value={convertAccessDays}
                onChange={(e) => setConvertAccessDays(e.target.value)}
                placeholder="Blank = unlimited"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertTargetId(null)}>Cancel</Button>
            <Button onClick={handleConvertConfirm} disabled={!convertRoomId || convertMutation.isPending}>
              {convertMutation.isPending ? 'Converting…' : 'Convert'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
