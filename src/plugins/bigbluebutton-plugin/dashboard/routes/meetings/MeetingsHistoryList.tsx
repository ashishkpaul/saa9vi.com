import { useQuery } from '@tanstack/react-query';
import { api, Badge, Button, Card, Skeleton } from '@vendure/dashboard';
import { graphql } from '@/gql';
import { useState } from 'react';
import { Link } from '@vendure/dashboard';
import { useCurrentOrganization } from '../../shared/useCurrentOrganization';
import { formatPaiseInr } from '../../../shared/format';

// ─── S5 (Phase 6 lean) — tenant Meetings history ─────────────────────────────
// Billed meeting history from bbbMeteredMeetings (D3: org from ctx.channelId,
// no org argument). Zero grant/provisioning vocabulary (A11): no meeting IDs,
// states, retry counts, or failure reasons. Money is integer paise on the
// wire, formatted only at the edge (ADR-047 integer-paise rule).

const METERED_MEETINGS = graphql(`
  query BbbTenantMeteredMeetings($month: String, $skip: Int, $take: Int) {
    bbbMeteredMeetings(month: $month, skip: $skip, take: $take) {
      items {
        id
        title
        roomId
        roomName
        startedAt
        completedAt
        peakLearners
        peakModerators
        learnerMinutes
        chargePaise
        billingCapped
        recordingUrl
      }
      totalItems
    }
  }
`);

function toStudentHours(learnerMinutes: number): string {
  return `${(learnerMinutes / 60).toFixed(1)} h`;
}

function formatWhen(startedAt: string, completedAt: string): string {
  const start = new Date(startedAt);
  const end = new Date(completedAt);
  const day = start.toLocaleDateString();
  const range = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return `${day} ${range}`;
}

export function MeetingsHistoryList() {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const { label, isLoading: orgLoading } = useCurrentOrganization();

  const meetingsQuery = useQuery({
    queryKey: ['bbbMeteredMeetings', page],
    queryFn: () =>
      api.query(METERED_MEETINGS, {
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    placeholderData: (prev) => prev,
  });

  const items = (meetingsQuery.data as any)?.bbbMeteredMeetings?.items ?? [];
  const totalItems = (meetingsQuery.data as any)?.bbbMeteredMeetings?.totalItems ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Meetings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {orgLoading ? 'Loading…' : label || 'No organization is bound to this channel'}
          {' · '}Billed class history — room, when, students, student-hours, charge, recording.
        </p>
      </div>

      <Card>
        {meetingsQuery.isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : meetingsQuery.isError ? (
          <div className="p-6 text-center text-red-500">Failed to load meetings</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">No billed meetings yet. Start a class from Rooms to see it here.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Room</th>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Students</th>
                    <th className="px-4 py-3 font-medium">Trainers</th>
                    <th className="px-4 py-3 font-medium">Student-hours</th>
                    <th className="px-4 py-3 font-medium">Charge</th>
                    <th className="px-4 py-3 font-medium">Recording</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((m: any) => (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="px-4 py-3">
                        {m.roomId ? (
                          <Link to={`/bbb/rooms/${m.roomId}`} className="font-medium text-blue-500 hover:underline">
                            {m.roomName || m.title}
                          </Link>
                        ) : (
                          <span className="font-medium">{m.roomName || m.title}</span>
                        )}
                        {m.billingCapped && (
                          <Badge variant="outline" className="ml-2">capped</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatWhen(m.startedAt, m.completedAt)}</td>
                      <td className="px-4 py-3">{m.peakLearners}</td>
                      <td className="px-4 py-3">{m.peakModerators}</td>
                      <td className="px-4 py-3">{toStudentHours(m.learnerMinutes)}</td>
                      <td className="px-4 py-3 font-medium">{formatPaiseInr(m.chargePaise)}</td>
                      <td className="px-4 py-3">
                        {m.recordingUrl ? (
                          <a href={m.recordingUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
                            Watch
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <div className="text-sm text-muted-foreground">{totalItems} total</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                <span className="text-sm">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

