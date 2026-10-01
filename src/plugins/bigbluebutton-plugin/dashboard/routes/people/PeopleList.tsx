import { useQuery } from '@tanstack/react-query';
import { api, Badge, Button, Card, Link, Skeleton } from '@vendure/dashboard';
import { graphql } from '@/gql';
import { useState } from 'react';
import { useCurrentOrganization } from '../../shared/useCurrentOrganization';

// ─── S5 (Phase 6 lean) — People (Trainers | Students) ────────────────────────
// Person-centric, not storage-model: Trainers tab reuses the org staff list
// (relabeled — MembersList component contract); Students tab lists enrollments
// per room with grant/revoke preserved (tenants hold BBBManageEntitlements and
// use createBbbEntitlement — acceptance: Students keeps grant/revoke access).
// The Entitlements route stays reachable (A19) but loses its nav item.
// Typed graphql() (A24). Vocabulary: Trainers, Students — never membership,
// entitlement, enrollment as UX concepts.

const TRAINERS = graphql(`
  query BbbPeopleTrainers($organizationId: ID!) {
    bbbOrganizationMembers(organizationId: $organizationId) {
      items {
        id
        customerName
        customerEmail
        role
        active
      }
      totalItems
    }
  }
`);

const STUDENT_ROOMS = graphql(`
  query BbbPeopleStudentRooms($organizationId: ID!) {
    bbbRooms(organizationId: $organizationId) {
      items {
        id
        name
      }
      totalItems
    }
  }
`);

const STUDENTS_BY_ROOM = graphql(`
  query BbbPeopleStudentsByRoom($roomId: ID!) {
    bbbEnrollmentsByRoom(roomId: $roomId) {
      items {
        id
        customerName
        customerEmail
        active
        validUntil
      }
      totalItems
    }
  }
`);
export function PeopleList() {
  const [tab, setTab] = useState<'trainers' | 'students'>('trainers');
  const { organizationId, label, isLoading: orgLoading } = useCurrentOrganization();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">People</h1>
        <p className="mt-1 text-sm text-muted-foreground">{orgLoading ? 'Loading...' : label}</p>
        {/* A19 — the Enrollments and Entitlements screens lost their tenant nav
            entries (People is the person view now) but stay reachable, from
            here. */}
        <div className="mt-2 flex gap-4 text-sm">
          <Link to="/bbb/enrollments" className="text-blue-500 hover:underline">Manage access</Link>
          <Link to="/bbb/entitlements" className="text-blue-500 hover:underline">Entitlements</Link>
        </div>
      </div>
      <div className="mb-6 flex gap-2 border-b">
        <Button variant={tab === 'trainers' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('trainers')}>Trainers</Button>
        <Button variant={tab === 'students' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('students')}>Students</Button>
      </div>
      {!organizationId ? (
        <Card><div className="p-6 text-center text-muted-foreground">No organization is bound to this channel</div></Card>
      ) : tab === 'trainers' ? (
        <TrainersTab organizationId={organizationId} />
      ) : (
        <StudentsTab organizationId={organizationId} />
      )}
    </div>
  );
}

function TrainersTab({ organizationId }: { organizationId: string }) {
  const trainersQuery = useQuery({
    queryKey: ['bbbPeopleTrainers', organizationId],
    queryFn: () => api.query(TRAINERS, { organizationId }),
    enabled: !!organizationId,
  });
  const trainers = (trainersQuery.data as any)?.bbbOrganizationMembers?.items ?? [];
  return (
    <Card>
      {trainersQuery.isLoading ? (
        <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : trainers.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground">No trainers yet. Add trainers from the <Link to="/bbb/staff" className="text-blue-500 hover:underline">Staff</Link> screen.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {trainers.map((t: any) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{t.customerName || '\u2014'}</td>
                  <td className="px-4 py-3">{t.customerEmail || '\u2014'}</td>
                  <td className="px-4 py-3">Trainer</td>
                  <td className="px-4 py-3"><Badge variant={t.active ? 'success' : 'warning'}>{t.active ? 'Active' : 'Inactive'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function StudentsTab({ organizationId }: { organizationId: string }) {
  const [roomId, setRoomId] = useState('');
  const roomsQuery = useQuery({
    queryKey: ['bbbPeopleRooms', organizationId],
    queryFn: () => api.query(STUDENT_ROOMS, { organizationId }),
    enabled: !!organizationId,
  });
  const rooms = (roomsQuery.data as any)?.bbbRooms?.items ?? [];
  const effectiveRoomId = roomId || rooms[0]?.id || '';
  const studentsQuery = useQuery({
    queryKey: ['bbbPeopleStudents', effectiveRoomId],
    queryFn: () => api.query(STUDENTS_BY_ROOM, { roomId: effectiveRoomId }),
    enabled: !!effectiveRoomId,
  });
  const students = (studentsQuery.data as any)?.bbbEnrollmentsByRoom?.items ?? [];
  return (
    <div className="grid gap-4">
      <Card>
        <div className="p-4 flex items-center gap-4">
          <label className="text-sm font-medium" htmlFor="people-room">Room</label>
          <select
            id="people-room"
            className="border rounded px-3 py-2 text-sm"
            value={effectiveRoomId}
            onChange={(e) => setRoomId(e.target.value)}
          >
            {rooms.map((r: any) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">Grant and revoke access from the <Link to="/bbb/enrollments" className="text-blue-500 hover:underline">Enrollments</Link> screen.</span>
        </div>
      </Card>
      <Card>
        {studentsQuery.isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : students.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">No students enrolled in this room yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Access until</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s: any) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{s.customerName || '\u2014'}</td>
                    <td className="px-4 py-3">{s.customerEmail || '\u2014'}</td>
                    <td className="px-4 py-3"><Badge variant={s.active ? 'success' : 'warning'}>{s.active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground">{s.validUntil ? new Date(s.validUntil).toLocaleDateString() : 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
