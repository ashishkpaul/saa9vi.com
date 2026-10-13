import { useQuery } from '@tanstack/react-query';
import { api } from '@vendure/dashboard';
import { graphql } from '@/gql';

/**
 * The active tenant for the current channel.
 *
 * Channel = Tenant (INV-001): a `BbbOrganization` is 1:1 with a Vendure
 * Channel, and the server resolves it from `ctx.channelId` — the same value
 * `BbbChannelAccessService` enforces on every BBB read and write.
 *
 * Tenant screens therefore must not run their own organization picker: doing
 * so lets the screen display organization B while the backend still evaluates
 * `ctx.channelId = A`, which is precisely the mismatch that makes
 * channel-scoped data (entitlements, capacity, ledger) unsound. Platform-tier
 * screens that intentionally browse across tenants (Organizations, Servers)
 * keep using `bbbOrganizations` — that is the only place a picker belongs.
 */
const GET_MY_ORGANIZATION = graphql(`
  query BbbMyOrganization {
    bbbMyOrganization {
      id
      channelId
      name
      slug
      suspended
    }
  }
`);

export interface CurrentOrganization {
  id: string;
  channelId: string;
  name: string;
  slug: string;
  suspended: boolean;
}

interface MyOrganizationResponse {
  bbbMyOrganization: CurrentOrganization | null;
}

export interface CurrentOrganizationResult {
  /** Organization id for the active channel, or '' when unknown/unbound. */
  organizationId: string;
  organization: CurrentOrganization | null;
  /** Display label, e.g. "Acme Academy · acme". */
  label: string;
  isLoading: boolean;
  isError: boolean;
}

export function useCurrentOrganization(): CurrentOrganizationResult {
  const query = useQuery<MyOrganizationResponse>({
    queryKey: ['bbbMyOrganization'],
    queryFn: () => api.query(GET_MY_ORGANIZATION) as Promise<MyOrganizationResponse>,
    staleTime: 5 * 60 * 1000,
  });

  const organization = query.data?.bbbMyOrganization ?? null;

  return {
    organizationId: organization?.id ? String(organization.id) : '',
    organization,
    label: organization
      ? `${organization.name}${
          organization.slug === '__default_channel__' ? '' : ` · ${organization.slug}`
        }${organization.suspended ? ' (suspended)' : ''}`
      : '',
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
