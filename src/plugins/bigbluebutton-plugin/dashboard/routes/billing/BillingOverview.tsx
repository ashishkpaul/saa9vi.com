import { useQuery } from '@tanstack/react-query';
import { api, Card, Skeleton } from '@vendure/dashboard';
import { graphql } from '@/gql';
import { useState } from 'react';
import { Link } from '@vendure/dashboard';
import { useCurrentOrganization } from '../../shared/useCurrentOrganization';
import { formatPaiseInr } from '../../../shared/format';

// ─── S5 (Phase 6 lean) — tenant Billing ─────────────────────────────────────
// One source: bbbBillingSummary (D3 — org from ctx.channelId, no org argument;
// no org picker here — INV-001). D2 — the month charge is rounded server-side
// once per month, half-up to the paisa; this screen never does money
// arithmetic. Zero grant vocabulary (A11). Money is integer paise on the wire
// and formatted only at this edge (ADR-047); student-hours = learnerMinutes/60
// to 1 decimal (IA rule).

const BILLING_SUMMARY = graphql(`
  query BbbTenantBillingSummary($month: String) {
    bbbBillingSummary(month: $month) {
      month
      ratePaisePerHour
      totalLearnerMinutes
      totalChargePaise
      spendLimitPaise
      spendLimitReached
      byRoom {
        roomId
        roomName
        learnerMinutes
        chargePaise
      }
    }
  }
`);

interface BillingRoomRow {
  roomId: string | null;
  roomName: string | null;
  learnerMinutes: number;
  chargePaise: number;
}

interface BillingSummary {
  month: string;
  ratePaisePerHour: number;
  totalLearnerMinutes: number;
  totalChargePaise: number;
  /** null = unlimited. */
  spendLimitPaise: number | null;
  spendLimitReached: boolean;
  byRoom: BillingRoomRow[];
}

/** Current UTC month as YYYY-MM — mirrors the server's default period month. */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function toStudentHours(learnerMinutes: number): string {
  return `${(learnerMinutes / 60).toFixed(1)} h`;
}

export function BillingOverview() {
  const { label, isLoading: orgLoading } = useCurrentOrganization();
  const [month, setMonth] = useState(currentMonth());

  const summaryQuery = useQuery({
    queryKey: ['bbbBillingSummary', month],
    queryFn: () => api.query(BILLING_SUMMARY, { month }),
    placeholderData: (prev) => prev,
  });

  const summary = (summaryQuery.data as any)?.bbbBillingSummary as BillingSummary | undefined;
  const rooms = summary?.byRoom ?? [];

  return (
    <div className="p-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {orgLoading ? 'Loading…' : label || 'No organization is bound to this channel'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium" htmlFor="billing-month">Month</label>
          <input
            id="billing-month"
            type="month"
            className="border rounded px-3 py-2 text-sm"
            value={month}
            onChange={(e) => setMonth(e.target.value || currentMonth())}
          />
        </div>
      </div>

      {summary?.spendLimitReached && (
        <div className="mb-4">
          <Card>
            <div className="p-4 text-sm text-destructive">
              This month has reached the account's spend limit — starting new classes is paused
              until it is lifted. Contact support.
            </div>
          </Card>
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card>
          <div className="p-6">
            <div className="text-sm text-muted-foreground">Rate</div>
            <div className="text-2xl font-bold">
              {summary ? `${formatPaiseInr(summary.ratePaisePerHour)} / student-hour` : <Skeleton className="h-8 w-32" />}
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <div className="text-sm text-muted-foreground">Student-hours</div>
            <div className="text-2xl font-bold">
              {summary ? toStudentHours(summary.totalLearnerMinutes) : <Skeleton className="h-8 w-24" />}
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <div className="text-sm text-muted-foreground">Charge</div>
            <div className="text-2xl font-bold">
              {summary ? formatPaiseInr(summary.totalChargePaise) : <Skeleton className="h-8 w-24" />}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {summary?.spendLimitPaise != null
                ? `Spend limit ${formatPaiseInr(summary.spendLimitPaise)}`
                : 'No spend limit'}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="border-b px-4 py-3 font-medium">Per-room breakdown</div>
        {summaryQuery.isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : summaryQuery.isError ? (
          <div className="p-6 text-center text-red-500">Failed to load billing</div>
        ) : rooms.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">No billed classes in {summary?.month ?? month}.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Room</th>
                  <th className="px-4 py-3 font-medium">Student-hours</th>
                  <th className="px-4 py-3 font-medium">Charge</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r, idx) => (
                  <tr key={r.roomId ?? `unassigned-${idx}`} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      {r.roomId ? (
                        <Link to={`/bbb/rooms/${r.roomId}`} className="font-medium text-blue-500 hover:underline">
                          {r.roomName ?? 'Unnamed room'}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.roomName ?? 'Not linked to a room'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{toStudentHours(r.learnerMinutes)}</td>
                    <td className="px-4 py-3 font-medium">{formatPaiseInr(r.chargePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Metered per student-hour, rounded once per month. Trainers are never billed. See{' '}
        <Link to="/bbb/meetings" className="text-blue-500 hover:underline">Meetings</Link> for the
        underlying class history.
      </p>
    </div>
  );
}
