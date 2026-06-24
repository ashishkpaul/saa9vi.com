import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, Button, Card, Input, Label, Switch } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import { AcademyPageHeader, AcademyStatusBadge, LoadingRows, useAutoProvisionTenantProfile } from '../../shared/academy-dashboard';

const CREATE_PROFILE = `
  mutation CreateTenantProfile($input: CreateTenantProfileInput!) {
    createTenantProfile(input: $input) { id channelId businessName contactEmail onboardingComplete }
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
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [saving, setSaving] = useState(false);

  const { tenantQuery, createMutation } = useAutoProvisionTenantProfile();
  const { data, isLoading } = tenantQuery;

  const existing = data?.tenantProfile;
  const isEditing = !!existing;

  useEffect(() => {
    if (existing) {
      setChannelId(existing.channelId);
      setBusinessName(existing.businessName);
      setTagline(existing.tagline ?? '');
      setTimezone(existing.timezone);
      setContactEmail(existing.contactEmail);
      setOnboardingComplete(existing.onboardingComplete);
    }
  }, [existing]);

  async function handleSave() {
    if (!businessName || !contactEmail) return;
    setSaving(true);
    try {
      if (isEditing) {
        await api.mutate(UPDATE_PROFILE, {
          input: { channelId, businessName, tagline, timezone, contactEmail, onboardingComplete },
        });
        toast.success('Tenant profile updated');
      } else {
        await api.mutate(CREATE_PROFILE, {
          input: { businessName, tagline, timezone, contactEmail },
        });
        toast.success('Tenant profile created');
      }
      qc.invalidateQueries({ queryKey: ['tenantProfile'] });
      qc.invalidateQueries({ queryKey: ['academyCounts'] });
    } catch (err: any) {
      toast.error('Error', { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || createMutation.isPending) {
    return <div className="p-6"><LoadingRows count={4} /></div>;
  }

  return (
    <div className="p-6 max-w-5xl">
      <AcademyPageHeader
        title={isEditing ? 'Tenant Profile' : 'Create Tenant Profile'}
        description="Configure the active channel's academy identity, contact metadata, timezone, and onboarding status. This is the root profile for the SaaS tenant."
      >
        {existing ? <AcademyStatusBadge complete={existing.onboardingComplete} /> : null}
      </AcademyPageHeader>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
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
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Onboarding complete</Label>
              <p className="text-xs text-muted-foreground">Mark this once profile, instructors, and media are ready for launch.</p>
            </div>
            <Switch checked={onboardingComplete} onCheckedChange={setOnboardingComplete} />
          </div>
          <div>
            <Button onClick={handleSave} disabled={!businessName || !contactEmail || saving}>
              {saving ? 'Saving...' : isEditing ? 'Update Profile' : 'Create Profile'}
            </Button>
          </div>
        </div>
      </Card>
      <Card className="p-6">
        <h2 className="font-semibold">Tenant rules</h2>
        <div className="mt-4 space-y-3 text-sm text-muted-foreground">
          <p><strong className="text-foreground">Channel = Tenant.</strong> This profile is scoped to the active Vendure channel.</p>
          <p>Use timezone and contact email consistently for live-session operations, notifications, and future billing workflows.</p>
          <p>Future branding fields such as logo and custom domain should extend this profile rather than creating a second tenant identity.</p>
        </div>
      </Card>
      </div>
    </div>
  );
}