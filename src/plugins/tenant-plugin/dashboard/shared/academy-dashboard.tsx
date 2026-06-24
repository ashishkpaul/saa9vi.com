import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Link, Skeleton } from '@vendure/dashboard';
import { ArrowRightIcon, Building2Icon, CheckCircle2Icon, CircleAlertIcon, FileImageIcon, LayoutDashboardIcon, UserSquare2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from 'sonner';

export const ACADEMY_NAV_ITEMS = [
  { id: 'academy-overview', title: 'Overview', href: '/academy', icon: LayoutDashboardIcon },
  { id: 'tenant-profile', title: 'Tenant Profile', href: '/academy/tenant-profile', icon: Building2Icon },
  { id: 'instructors', title: 'Instructors', href: '/academy/instructors', icon: UserSquare2Icon },
  { id: 'media-resources', title: 'Media Library', href: '/academy/media', icon: FileImageIcon },
];

export const GET_TENANT_PROFILE = `
  query GetTenantProfile($channelId: String) {
    tenantProfile(channelId: $channelId) {
      id channelId businessName tagline timezone contactEmail onboardingComplete logoAssetId
    }
  }
`;

export const GET_ACADEMY_COUNTS = `
  query GetAcademyCounts {
    instructorProfiles(options: { take: 1 }) { totalItems }
    mediaResources(options: { take: 1 }) { totalItems }
  }
`;

export const CREATE_TENANT_PROFILE = `
  mutation CreateTenantProfile($input: CreateTenantProfileInput!) {
    createTenantProfile(input: $input) {
      id channelId businessName tagline timezone contactEmail onboardingComplete logoAssetId
    }
  }
`;

export interface TenantProfile {
  id: string;
  channelId: string;
  businessName: string;
  tagline?: string | null;
  timezone: string;
  contactEmail: string;
  onboardingComplete: boolean;
  logoAssetId?: string | null;
}

export interface AcademyCounts {
  instructorProfiles: { totalItems: number };
  mediaResources: { totalItems: number };
}

export function useTenantProfile() {
  return useQuery<{ tenantProfile: TenantProfile | null }>({
    queryKey: ['tenantProfile'],
    queryFn: () => api.query(GET_TENANT_PROFILE, {}),
  });
}

export function useAutoProvisionTenantProfile(enabled = true) {
  const queryClient = useQueryClient();
  const tenantQuery = useTenantProfile();
  const createMutation = useMutation({
    mutationFn: () => api.mutate(CREATE_TENANT_PROFILE, {
      input: {
        businessName: 'Default Academy',
        tagline: 'Configure your academy profile',
        timezone: 'UTC',
        contactEmail: 'admin@local.dev',
      },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenantProfile'] });
      toast.success('Academy profile initialized');
    },
    onError: (err: Error) => {
      toast.error('Unable to initialize academy profile', { description: err.message });
    },
  });

  useEffect(() => {
    if (!enabled || tenantQuery.isLoading || tenantQuery.isFetching || tenantQuery.data?.tenantProfile || createMutation.isPending || createMutation.isSuccess) {
      return;
    }
    createMutation.mutate();
  }, [enabled, tenantQuery.isLoading, tenantQuery.isFetching, tenantQuery.data?.tenantProfile, createMutation.isPending, createMutation.isSuccess]);

  return { tenantQuery, createMutation };
}

export function useAcademyCounts() {
  return useQuery<AcademyCounts>({
    queryKey: ['academyCounts'],
    queryFn: () => api.query(GET_ACADEMY_COUNTS),
  });
}

export function AcademyPageHeader({
  title,
  description,
  children,
}: Readonly<{ title: string; description: string; children?: React.ReactNode }>) {
  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Academy Console</p>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
        {children ? <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div> : null}
      </div>
      <AcademySectionNav />
    </div>
  );
}

export function AcademySectionNav() {
  const currentPath = typeof window !== 'undefined' ? window.location.pathname.replace(/^\/dashboard/, '') : '';

  return (
    <nav className="flex flex-wrap gap-2 rounded-lg border bg-card p-2" aria-label="Academy navigation">
      {ACADEMY_NAV_ITEMS.map(item => {
        const Icon = item.icon;
        const isActive = currentPath === item.href;
        return (
          <Link
            key={item.id}
            to={item.href}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <Icon className="h-4 w-4" />
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}

export function PaginationFooter({
  page,
  totalPages,
  totalItems,
  onPrevious,
  onNext,
}: Readonly<{ page: number; totalPages: number; totalItems: number; onPrevious: () => void; onNext: () => void }>) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t">
      <div className="text-sm text-muted-foreground">{totalItems} total</div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={onPrevious}>Previous</Button>
        <span className="text-sm">Page {page} of {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}

export function EmptyState({ title, description }: Readonly<{ title: string; description: string }>) {
  return (
    <div className="p-8 text-center">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
    </div>
  );
}

export function AcademyStatusBadge({ complete }: Readonly<{ complete: boolean }>) {
  return complete
    ? <Badge variant="success">Onboarding complete</Badge>
    : <Badge variant="warning">Setup in progress</Badge>;
}

export function LoadingRows({ count = 4 }: Readonly<{ count?: number }>) {
  return <div className="p-4 space-y-3">{Array.from({ length: count }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
}

export function AcademyHome() {
  const { tenantQuery, createMutation } = useAutoProvisionTenantProfile();
  const countsQuery = useAcademyCounts();
  const tenant = tenantQuery.data?.tenantProfile;
  const instructorCount = countsQuery.data?.instructorProfiles?.totalItems ?? 0;
  const mediaCount = countsQuery.data?.mediaResources?.totalItems ?? 0;
  const steps = [
    { label: 'Create tenant profile', done: !!tenant, href: '/academy/tenant-profile' },
    { label: 'Complete academy branding and contact details', done: !!tenant?.onboardingComplete, href: '/academy/tenant-profile' },
    { label: 'Publish at least one instructor', done: instructorCount > 0, href: '/academy/instructors' },
    { label: 'Add media resources for profiles/courses', done: mediaCount > 0, href: '/academy/media' },
  ];

  return (
    <div className="p-6">
      <AcademyPageHeader
        title="Academy Overview"
        description="Operate the current Vendure channel as a tenant academy: profile, instructors, media, and future learning workflows from one console."
      >
        <Button variant="outline" render={<Link to="/academy/tenant-profile" />}>Open Profile</Button>
      </AcademyPageHeader>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5 md:col-span-2">
          {tenantQuery.isLoading || createMutation.isPending ? <Skeleton className="h-32 w-full" /> : tenant ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{tenant.businessName}</h2>
                  <p className="text-sm text-muted-foreground">{tenant.tagline || 'No tagline configured yet'}</p>
                </div>
                <AcademyStatusBadge complete={tenant.onboardingComplete} />
              </div>
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div><div className="text-muted-foreground">Channel</div><code>{tenant.channelId}</code></div>
                <div><div className="text-muted-foreground">Timezone</div><div>{tenant.timezone}</div></div>
                <div><div className="text-muted-foreground">Contact</div><div>{tenant.contactEmail}</div></div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <CircleAlertIcon className="mt-1 h-5 w-5 text-amber-500" />
              <div>
                <h2 className="text-lg font-semibold">Tenant profile required</h2>
                <p className="text-sm text-muted-foreground">The dashboard could not initialize a profile automatically. Create one manually or retry initialization.</p>
                <Button className="mt-3" size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Initializing...' : 'Retry initialization'}
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Academy metrics</h2>
          {countsQuery.isLoading ? <Skeleton className="mt-4 h-24 w-full" /> : (
            <div className="mt-4 grid gap-3">
              <Metric label="Instructors" value={instructorCount} />
              <Metric label="Media resources" value={mediaCount} />
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold">Onboarding checklist</h2>
          <div className="mt-4 space-y-3">
            {steps.map(step => (
              <Link key={step.label} to={step.href} className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50">
                <span className="flex items-center gap-2 text-sm">
                  {step.done ? <CheckCircle2Icon className="h-4 w-4 text-green-600" /> : <CircleAlertIcon className="h-4 w-4 text-amber-500" />}
                  {step.label}
                </span>
                <ArrowRightIcon className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Workflow map</h2>
          <div className="mt-4 grid gap-3 text-sm text-muted-foreground">
            <WorkflowStep title="1. Tenant Profile" text="Configure channel identity, branding metadata, timezone, and contact details." />
            <WorkflowStep title="2. Instructors" text="Create public teaching profiles that can power marketplace and course pages." />
            <WorkflowStep title="3. Media Library" text="Attach images, video, documents, and future course/session media to domain owners." />
            <WorkflowStep title="4. Courses & Sessions" text="Future LMS modules should attach to this console rather than becoming isolated CRUD pages." />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function WorkflowStep({ title, text }: Readonly<{ title: string; text: string }>) {
  return (
    <div className="rounded-md border p-3">
      <div className="font-medium text-foreground">{title}</div>
      <div>{text}</div>
    </div>
  );
}