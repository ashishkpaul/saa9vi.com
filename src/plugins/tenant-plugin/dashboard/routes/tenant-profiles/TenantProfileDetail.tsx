import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, Button, Card, Input, Label, Skeleton } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';

const GET_PROFILE = `
  query GetTenantProfile($channelId: String!) {
    tenantProfile(channelId: $channelId) {
      id channelId businessName tagline timezone contactEmail onboardingComplete
    }
  }
`;

const CREATE_PROFILE = `
  mutation CreateTenantProfile($input: CreateTenantProfileInput!) {
    createTenantProfile(input: $input) { id businessName contactEmail }
  }
`;

const UPDATE_PROFILE = `
  mutation UpdateTenantProfile($input: UpdateTenantProfileInput!) {
    updateTenantProfile(input: $input) { id businessName tagline timezone contactEmail onboardingComplete }
  }
`;

interface TenantProfile {
  id: string; channelId: string; businessName: string;
  tagline?: string; timezone: string; contactEmail: string; onboardingComplete: boolean;
}

export function TenantProfileDetail() {
  const qc = useQueryClient();
  const [channelId, setChannelId] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [tagline, setTagline] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [contactEmail, setContactEmail] = useState('');
  const [saving, setSaving] = useState(false);

  // Try to fetch existing profile for current channel
  const { data, isLoading } = useQuery<{ tenantProfile: TenantProfile | null }>({
    queryKey: ['tenantProfile'],
    queryFn: () => api.query(GET_PROFILE, { channelId: '__current__' }),
  });

  const existing = data?.tenantProfile;
  const isEditing = !!existing;

  // Populate form when data loads
  useState(() => {
    if (existing) {
      setChannelId(existing.channelId);
      setBusinessName(existing.businessName);
      setTagline(existing.tagline ?? '');
      setTimezone(existing.timezone);
      setContactEmail(existing.contactEmail);
    }
  });

  async function handleSave() {
    if (!businessName || !contactEmail) return;
    setSaving(true);
    try {
      if (isEditing) {
        await api.mutate(UPDATE_PROFILE, {
          input: { channelId, businessName, tagline, timezone, contactEmail },
        });
        toast.success('Tenant profile updated');
      } else {
        await api.mutate(CREATE_PROFILE, {
          input: { businessName, tagline, timezone, contactEmail },
        });
        toast.success('Tenant profile created');
      }
      qc.invalidateQueries({ queryKey: ['tenantProfile'] });
    } catch (err: any) {
      toast.error('Error', { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <div className="p-6"><Skeleton className="h-40 w-full" /></div>;
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">
        {isEditing ? 'Edit Tenant Profile' : 'Create Tenant Profile'}
      </h1>

      <Card className="p-6">
        {isEditing && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
            Profile exists for channel. Update fields below.
          </div>
        )}

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Business Name</Label>
            <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Academy" />
          </div>
          <div className="grid gap-2">
            <Label>Tagline</Label>
            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Learn from the best" />
          </div>
          <div className="grid gap-2">
            <Label>Timezone</Label>
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
          </div>
          <div className="grid gap-2">
            <Label>Contact Email</Label>
            <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="admin@acme.com" />
          </div>
          <div>
            <Button onClick={handleSave} disabled={!businessName || !contactEmail || saving}>
              {saving ? 'Saving...' : isEditing ? 'Update Profile' : 'Create Profile'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}