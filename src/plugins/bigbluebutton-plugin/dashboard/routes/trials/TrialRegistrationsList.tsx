import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { graphql } from '@/gql';
import { useCurrentOrganization } from '../../shared/useCurrentOrganization';

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

// Rooms of the caller's OWN organization (resolved server-side from the
// channel), so the conversion dialog offers only ids the server will accept —
// replacing the old free-text window.prompt() room id (production-readiness
// item 2, UX half).
const GET_ROOMS = graphql(`
  query GetBbbTrialConvertRooms($organizationId: ID!) {
    bbbRooms(organizationId: $organizationId) {
      items {
        id
        name
      }
    }
  }
`);

const STATUS_BADGE: Record<string, { variant: 'success' | 'warning' | 'destructive' | 'outline'; label: string }> = {
  REGISTERED: { variant: 'outline', label: 'Registered' },
  ATTENDED: { variant: 'success', label: 'Attended' },
  CANCELLED: { variant: 'warning', label: 'Cancelled' },
  NO_SHOW: { variant: 'destructive', label: 'No Show' },
};

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
  // Channel = Tenant (INV-001): the organization is resolved server-side from
  // the active channel — a client-side picker could disagree with ctx.channelId.
  const { organizationId, label, isLoading: orgLoading } = useCurrentOrganization();

  const registrationsQuery = useQuery({
    queryKey: ['trialRegistrations', organizationId],
    queryFn: () => api.query(GET_TRIAL_REGISTRATIONS, { organizationId }),
    enabled: !!organizationId,
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

  const convertMutation = useMutation({
    mutationFn: ({ registrationId, roomId, accessDays }: { registrationId: string; roomId: string; accessDays?: number }) =>
      api.mutate(CONVERT_TO_ENROLLMENT, { registrationId, roomId, accessDays }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trialRegistrations'] });
      toast.success('Trial converted to learner successfully');
      setConvertTarget(null);
      setTargetRoomId('');
      setAccessDaysInput('');
    },
    onError: (err: Error) => toast.error('Conversion failed', { description: err.message }),
  });

  // Dialog state replaces the two window.prompt() calls (production-readiness
  // item 2): a room Select fed by the typed bbbRooms query (only this org's
  // rooms are offerable) + a validated numeric access-days input.
  const [convertTarget, setConvertTarget] = useState<string | null>(null);
  const [targetRoomId, setTargetRoomId] = useState('');
  const [accessDaysInput, setAccessDaysInput] = useState('');

  const roomsQuery = useQuery({
    queryKey: ['trialConvertRooms', organizationId],
    queryFn: () => api.query(GET_ROOMS, { organizationId }),
    enabled: !!organizationId && convertTarget !== null,
  });
  const rooms = roomsQuery.data?.bbbRooms.items ?? [];

  const accessDaysValid =
    accessDaysInput.trim() === '' ||
    (Number.isFinite(Number(accessDaysInput)) && Number(accessDaysInput) > 0);

  function openConvert(registrationId: string) {
    setConvertTarget(registrationId);
    setTargetRoomId('');
    setAccessDaysInput('');
  }

  function handleConvertConfirm() {
    if (!convertTarget) return;
    if (!targetRoomId) {
      toast.error('Room required', { description: 'Select a room to enroll this learner into.' });
      return;
    }
    if (!accessDaysValid) {
      toast.error('Invalid access days', { description: 'Please enter a positive number of days, or leave it blank.' });
      return;
    }
    const trimmed = accessDaysInput.trim();
    convertMutation.mutate({
      registrationId: convertTarget,
      roomId: targetRoomId,
      accessDays: trimmed === '' ? undefined : Number(trimmed),
    });
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Trial Registrations</h1>
      </div>

      <div className="max-w-xs mb-6">
        <Label>Organization</Label>
        <p className="mt-1 text-sm text-muted-foreground">
          {orgLoading ? 'Loading…' : label || 'No organization is bound to this channel'}
        </p>
      </div>

      <Dialog open={convertTarget !== null} onOpenChange={(open) => { if (!open) setConvertTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to learner</DialogTitle>
            <DialogDescription>
              Choose the room this learner should be enrolled into. Only rooms of your
              organization are listed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="convert-room">Room</Label>
              <Select value={targetRoomId} onValueChange={setTargetRoomId}>
                <SelectTrigger id="convert-room">
                  <SelectValue placeholder={roomsQuery.isLoading ? 'Loading rooms…' : 'Select a room'} />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((room) => (
                    <SelectItem key={room.id} value={room.id}>
                      {room.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!roomsQuery.isLoading && rooms.length === 0 && (
                <p className="text-sm text-muted-foreground">No rooms in this organization.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="convert-access-days">Access days (optional — blank for unlimited)</Label>
              <Input
                id="convert-access-days"
                type="number"
                min={1}
                value={accessDaysInput}
                onChange={(e) => setAccessDaysInput(e.target.value)}
                placeholder="e.g. 30"
              />
              {!accessDaysValid && (
                <p className="text-sm text-destructive">Enter a positive number of days.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertTarget(null)}>Cancel</Button>
            <Button
              onClick={handleConvertConfirm}
              disabled={convertMutation.isPending || !targetRoomId || !accessDaysValid}
            >
              {convertMutation.isPending ? 'Converting…' : 'Convert'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        {registrationsQuery.isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !organizationId ? (
          <div className="p-6 text-center text-muted-foreground">No organization is bound to this channel</div>
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
    </div>
  );
}