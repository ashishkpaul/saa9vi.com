import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Skeleton, DashboardRouteDefinition } from '@vendure/dashboard';
import type { AnyRoute } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { Link } from '@vendure/dashboard';

const STATUS_BADGE: Record<string, 'success' | 'warning' | 'default' | 'destructive'> = {
  SCHEDULED: 'default',
  LIVE: 'success',
  FINISHED: 'default',
  CANCELLED: 'destructive',
};

const GET_SESSION = `
  query GetBbbScheduledSession($id: ID!) {
    bbbScheduledSession(id: $id) {
      id
      title
      status
      startTime
      endTime
      trainerId
      isTrial
      visibility
      maxAttendees
      productVariantId
      activeMeetingId
      organization { id name slug }
    }
  }
`;

const CANCEL_SESSION = `
  mutation CancelBbbScheduledSession($id: ID!) {
    cancelBbbScheduledSession(id: $id) { id status }
  }
`;

interface BbbScheduledSession {
  id: string;
  title: string;
  status: string;
  startTime: string;
  endTime: string;
  trainerId: string;
  isTrial: boolean;
  visibility: string;
  maxAttendees: number | null;
  productVariantId: string | null;
  activeMeetingId: string | null;
  organization: { id: string; name: string; slug: string };
}

interface SessionResponse {
  bbbScheduledSession: BbbScheduledSession | null;
}

export const sessionDetail: DashboardRouteDefinition = {
  path: '/bbb/sessions/$id',
  component: (route) => <SessionDetailPage route={route} />,
};

function SessionDetailPage({ route }: { route: AnyRoute }) {
  const params = route.useParams();
  const id = params.id;
  const queryClient = useQueryClient();
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const { data, isLoading, isError } = useQuery<SessionResponse>({
    queryKey: ['bbbScheduledSession', id],
    queryFn: () => api.query(GET_SESSION, { id }),
    enabled: !!id,
  });

  const session = data?.bbbScheduledSession ?? null;

  const cancelMutation = useMutation({
    mutationFn: (sessionId: string) => api.mutate(CANCEL_SESSION, { id: sessionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bbbScheduledSession', id] });
      queryClient.invalidateQueries({ queryKey: ['bbbScheduledSessions'] });
      setShowCancelDialog(false);
      toast.success('Session cancelled');
    },
    onError: (err: Error) => toast.error('Error', { description: err.message }),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !session) {
    return (
      <div className="p-6">
        <div className="mb-4">
          <Link to="/bbb/sessions" className="text-sm text-blue-500 hover:underline">&larr; Back to Sessions</Link>
        </div>
        <Card>
          <div className="p-6 text-center text-red-500">
            {isError ? 'Failed to load session' : 'Session not found'}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link to="/bbb/sessions" className="text-sm text-blue-500 hover:underline">&larr; Back to Sessions</Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{session.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {session.organization.name} ({session.organization.slug})
          </p>
        </div>
        <Badge variant={STATUS_BADGE[session.status] ?? 'default'} className="text-sm px-3 py-1">
          {session.status}
        </Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Session Information */}
        <Card>
          <CardHeader>
            <CardTitle>Session Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={STATUS_BADGE[session.status] ?? 'default'}>{session.status}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Start Time</span>
              <span className="text-sm font-medium">{new Date(session.startTime).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">End Time</span>
              <span className="text-sm font-medium">{new Date(session.endTime).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Duration</span>
              <span className="text-sm font-medium">
                {Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 60000)} min
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Trainer ID</span>
              <code className="text-xs">{session.trainerId}</code>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Visibility</span>
              <span className="text-sm font-medium">{session.visibility}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Trial Session</span>
              <Badge variant={session.isTrial ? 'warning' : 'default'}>{session.isTrial ? 'Yes' : 'No'}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Max Attendees</span>
              <span className="text-sm font-medium">{session.maxAttendees ?? 'Unlimited'}</span>
            </div>
          </CardContent>
        </Card>

        {/* Commercial Reference */}
        <Card>
          <CardHeader>
            <CardTitle>Commercial Reference</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Product Variant ID</span>
              {session.productVariantId ? (
                <code className="text-xs">{session.productVariantId}</code>
              ) : (
                <span className="text-sm italic text-muted-foreground">Not linked</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Live Runtime */}
        <Card>
          <CardHeader>
            <CardTitle>Live Runtime</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Active Meeting</span>
              {session.activeMeetingId ? (
                <Link to={`/bbb/meetings/${session.activeMeetingId}`} className="text-sm text-blue-500 hover:underline">
                  View Meeting Detail &rarr;
                </Link>
              ) : (
                <span className="text-sm italic text-muted-foreground">No active meeting</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="mt-6 flex gap-3">
        {session.status === 'SCHEDULED' && (
          <Button variant="destructive" onClick={() => setShowCancelDialog(true)}>
            Cancel Session
          </Button>
        )}
      </div>

      <Dialog open={showCancelDialog} onOpenChange={(o) => !o && setShowCancelDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Session</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel "{session.title}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelDialog(false)}>Keep</Button>
            <Button
              variant="destructive"
              onClick={() => cancelMutation.mutate(session.id)}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
