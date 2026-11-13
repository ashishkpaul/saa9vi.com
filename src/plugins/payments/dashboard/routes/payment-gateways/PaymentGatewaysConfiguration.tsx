import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, Button, Card, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState, useEffect } from 'react';

import { graphql } from '@/gql';
import {
  PaymentGatewayPageHeader,
  PaymentGatewayStatusBadge,
  LoadingRows,
  ConnectionStatusCard,
} from '../../shared';
import {
  GET_TENANT_PAYMENT_ACCOUNT,
  UPSERT_TENANT_PAYMENT_ACCOUNT,
  SET_TENANT_PAYMENT_ACCOUNT_ENABLED,
  DELETE_TENANT_PAYMENT_ACCOUNT,
  VERIFY_TENANT_PAYMENT_ACCOUNT,
  VERIFY_TENANT_PAYMENT_WEBHOOK,
  type TenantPaymentAccountData,
} from '../../shared/queries';

type AccountMode = 'test' | 'live';
type AccountStatus = 'not-configured' | 'pending' | 'active' | 'disabled';

export function PaymentGatewaysConfiguration() {
  const queryClient = useQueryClient();
  
  // Form state
  const [keyId, setKeyId] = useState('');
  const [keySecret, setKeySecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [accountMode, setAccountMode] = useState<AccountMode>('test');
  
  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isVerifyingWebhook, setIsVerifyingWebhook] = useState(false);
  
  // GraphQL queries and mutations
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tenantPaymentAccount'],
    queryFn: () => api.query(GET_TENANT_PAYMENT_ACCOUNT, {}),
  });
  
  const upsertMutation = useMutation({
    mutationFn: (input: any) => api.mutate(UPSERT_TENANT_PAYMENT_ACCOUNT, { input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenantPaymentAccount'] });
      toast.success('Credentials saved');
    },
    onError: (error: any) => {
      toast.error('Error saving credentials', { description: error.message });
    },
  });
  
  const enableMutation = useMutation({
    mutationFn: (isEnabled: boolean) => api.mutate(SET_TENANT_PAYMENT_ACCOUNT_ENABLED, { isEnabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenantPaymentAccount'] });
      toast.success('Gateway status updated');
    },
    onError: (error: any) => {
      toast.error('Error updating gateway status', { description: error.message });
    },
  });
  
  const deleteMutation = useMutation({
    mutationFn: () => api.mutate(DELETE_TENANT_PAYMENT_ACCOUNT, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenantPaymentAccount'] });
      resetForm();
      toast.success('Configuration deleted');
    },
    onError: (error: any) => {
      toast.error('Error deleting configuration', { description: error.message });
    },
  });
  
  const verifyMutation = useMutation({
    mutationFn: () => api.mutate(VERIFY_TENANT_PAYMENT_ACCOUNT, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenantPaymentAccount'] });
      toast.success('Credentials verified successfully');
    },
    onError: (error: any) => {
      toast.error('Verification failed', { description: error.message });
    },
  });
  
  const verifyWebhookMutation = useMutation({
    mutationFn: () => api.mutate(VERIFY_TENANT_PAYMENT_WEBHOOK, {}),
    onSuccess: () => {
      toast.success('Webhook secret verified');
    },
    onError: (error: any) => {
      toast.error('Webhook verification failed', { description: error.message });
    },
  });
  
  const account = data?.tenantPaymentAccount as TenantPaymentAccountData | null;
  
  // Determine account status for display
  const getDisplayStatus = (): AccountStatus => {
    if (!account || !account.credentialsConfigured) {
      return 'not-configured';
    }
    
    if (account.status === 'pending') {
      return 'pending';
    }
    
    if (account.status === 'active' && account.isEnabled) {
      return 'active';
    }
    
    if (account.status === 'active' && !account.isEnabled) {
      return 'disabled';
    }
    
    if (account.status === 'verification-failed') {
      return 'verification-failed';
    }
    
    return 'not-configured';
  };
  
  const displayStatus = getDisplayStatus();
  
  // Reset form when account data loads
  useEffect(() => {
    if (account) {
      setKeyId(account.keyId || '');
      setAccountMode((account.accountMode as AccountMode) || 'test');
      // Don't populate secrets - they're never returned from the API
      setKeySecret('');
      setWebhookSecret('');
    } else {
      resetForm();
    }
  }, [account]);
  
  const resetForm = () => {
    setKeyId('');
    setKeySecret('');
    setWebhookSecret('');
    setAccountMode('test');
  };
  
  const handleSaveCredentials = async () => {
    if (!keyId || !keySecret) {
      toast.error('Missing required fields', { description: 'Key ID and Key Secret are required' });
      return;
    }
    
    setIsSaving(true);
    try {
      await upsertMutation.mutateAsync({
        keyId: keyId.trim(),
        keySecret: keySecret.trim(),
        webhookSecret: webhookSecret.trim() || undefined,
        accountMode,
      });
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      await verifyMutation.mutateAsync();
    } finally {
      setIsTesting(false);
    }
  };
  
  const handleVerifyWebhook = async () => {
    setIsVerifyingWebhook(true);
    try {
      await verifyWebhookMutation.mutateAsync();
    } finally {
      setIsVerifyingWebhook(false);
    }
  };
  
  const handleToggleEnabled = async (enabled: boolean) => {
    if (!account) {
      toast.error('No account configured', { description: 'Please configure credentials first' });
      return;
    }
    
    if (enabled && account.status !== 'active') {
      toast.error('Account not verified', { description: 'Please verify credentials before enabling' });
      return;
    }
    
    await enableMutation.mutateAsync(enabled);
  };
  
  const handleDeleteConfiguration = async () => {
    if (!account) {
      toast.error('No account to delete');
      return;
    }
    
    if (confirm('Are you sure you want to delete the payment gateway configuration? This action cannot be undone.')) {
      await deleteMutation.mutateAsync();
    }
  };
  
  if (isLoading) {
    return (
      <div className="p-6">
        <PaymentGatewayPageHeader 
          title="Payment Gateways" 
          description="Loading payment gateway configuration..." 
        />
        <Card className="p-6">
          <LoadingRows count={4} />
        </Card>
      </div>
    );
  }
  
  if (isError) {
    return (
      <div className="p-6">
        <PaymentGatewayPageHeader 
          title="Payment Gateways" 
          description="Error loading payment gateway configuration" 
        />
        <Card className="p-6">
          <div className="text-red-600">
            Failed to load payment gateway configuration. Please try again.
          </div>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="p-6 max-w-6xl">
      <PaymentGatewayPageHeader
        title="Payment Gateways"
        description="Configure your own Razorpay merchant account for collecting payments from your learners. Credentials are encrypted and never exposed through the API."
      >
        {account && <PaymentGatewayStatusBadge status={displayStatus} />}
      </PaymentGatewayPageHeader>
      
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column: Configuration form */}
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Razorpay Configuration</h2>
            
            {account?.credentialsConfigured && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
                Credentials are configured. Enter new values to rotate credentials (this will disable the gateway until re-verified).
              </div>
            )}
            
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="keyId">Razorpay Key ID *</Label>
                <Input
                  id="keyId"
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  placeholder="rzp_test_XXXXXXXXXXXXXX"
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  Your Razorpay API Key ID (starts with rzp_test_ or rzp_live_)
                </p>
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="keySecret">Razorpay Key Secret *</Label>
                <Input
                  id="keySecret"
                  type="password"
                  value={keySecret}
                  onChange={(e) => setKeySecret(e.target.value)}
                  placeholder={account?.credentialsConfigured ? "••••••••••••" : "Enter your key secret"}
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  Your Razorpay API Key Secret. {account?.credentialsConfigured ? 'Enter a new value to rotate.' : 'Required for API access.'}
                </p>
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="webhookSecret">Webhook Secret (Optional)</Label>
                <Input
                  id="webhookSecret"
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={account?.webhookSecretConfigured ? "••••••••••••" : "Enter webhook secret"}
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  Used to verify Razorpay webhook signatures. Recommended for production.
                </p>
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="accountMode">Account Mode *</Label>
                <Select value={accountMode} onValueChange={(value: AccountMode) => setAccountMode(value)} disabled={isSaving}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">Test Mode</SelectItem>
                    <SelectItem value="live">Live Mode</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {accountMode === 'test' 
                    ? 'Test mode uses Razorpay sandbox. No real payments will be processed.'
                    : 'Live mode processes real payments. Use only with verified credentials.'}
                </p>
              </div>
              
              <div className="pt-4">
                <Button 
                  onClick={handleSaveCredentials}
                  disabled={isSaving || !keyId || !keySecret}
                  className="w-full"
                >
                  {isSaving ? 'Saving...' : account ? 'Update Credentials' : 'Save Credentials'}
                </Button>
              </div>
            </div>
          </Card>
          
          {/* Connection status cards */}
          <div className="space-y-4">
            <ConnectionStatusCard
              title="API Credentials"
              status={
                !account?.credentialsConfigured ? 'neutral' :
                account?.status === 'active' ? 'success' :
                account?.status === 'pending' ? 'warning' :
                account?.status === 'verification-failed' ? 'error' : 'neutral'
              }
              description={
                !account?.credentialsConfigured ? 'Not configured' :
                account?.status === 'active' ? `Verified ${account.lastVerifiedAt ? new Date(account.lastVerifiedAt).toLocaleDateString() : ''}` :
                account?.status === 'pending' ? 'Pending verification' :
                account?.status === 'verification-failed' ? 'Verification failed' : 'Unknown status'
              }
            >
              {account?.credentialsConfigured && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleTestConnection}
                  disabled={isTesting || !account?.credentialsConfigured}
                >
                  {isTesting ? 'Testing...' : 'Test Connection'}
                </Button>
              )}
            </ConnectionStatusCard>
            
            <ConnectionStatusCard
              title="Webhook"
              status={account?.webhookSecretConfigured ? 'success' : 'warning'}
              description={
                account?.webhookSecretConfigured 
                  ? 'Webhook secret is configured and can be decrypted'
                  : 'Webhook secret is not configured. Recommended for production.'
              }
            >
              {account?.credentialsConfigured && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleVerifyWebhook}
                  disabled={isVerifyingWebhook || !account?.credentialsConfigured}
                >
                  {isVerifyingWebhook ? 'Checking...' : 'Check Webhook Secret'}
                </Button>
              )}
            </ConnectionStatusCard>
            
            <ConnectionStatusCard
              title="Checkout"
              status={account?.isEnabled ? 'success' : 'neutral'}
              description={
                account?.isEnabled 
                  ? 'Payment gateway is enabled for checkout'
                  : account?.status === 'active'
                    ? 'Payment gateway is verified but disabled'
                    : 'Payment gateway is not ready for checkout'
              }
            >
              {account?.credentialsConfigured && account?.status === 'active' && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={account?.isEnabled}
                    onCheckedChange={handleToggleEnabled}
                    disabled={enableMutation.isPending}
                  />
                  <span className="text-sm">
                    {enableMutation.isPending ? 'Updating...' : account?.isEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              )}
            </ConnectionStatusCard>
          </div>
        </div>
        
        {/* Right column: Information and actions */}
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Gateway Information</h2>
            
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="text-muted-foreground">Provider</div>
                <div className="font-medium">Razorpay</div>
              </div>
              
              {account && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-muted-foreground">Account ID</div>
                    <div className="font-mono text-xs truncate">{account.keyId}</div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-muted-foreground">Mode</div>
                    <div className="font-medium capitalize">{account.accountMode}</div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-muted-foreground">Status</div>
                    <div className="font-medium capitalize">{account.status}</div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-muted-foreground">Last Verified</div>
                    <div>
                      {account.lastVerifiedAt 
                        ? new Date(account.lastVerifiedAt).toLocaleString()
                        : 'Never'
                      }
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-muted-foreground">Created</div>
                    <div>{new Date(account.createdAt).toLocaleDateString()}</div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-muted-foreground">Updated</div>
                    <div>{new Date(account.updatedAt).toLocaleDateString()}</div>
                  </div>
                </>
              )}
            </div>
          </Card>
          
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Gateway Actions</h2>
            
            <div className="space-y-3">
              <div>
                <h3 className="font-medium mb-2">Verification</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  After saving credentials, test the connection to verify they work with Razorpay API.
                </p>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={handleTestConnection}
                  disabled={isTesting || !account?.credentialsConfigured}
                >
                  {isTesting ? 'Testing...' : 'Test API Connection'}
                </Button>
              </div>
              
              <div>
                <h3 className="font-medium mb-2">Enable/Disable</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Enable the gateway to allow learners to pay with Razorpay. Disable to temporarily stop payments.
                </p>
                <div className="flex items-center justify-between p-3 border rounded">
                  <div>
                    <div className="font-medium">Gateway Status</div>
                    <div className="text-sm text-muted-foreground">
                      {account?.isEnabled ? 'Enabled for checkout' : 'Disabled'}
                    </div>
                  </div>
                  <Switch
                    checked={account?.isEnabled || false}
                    onCheckedChange={handleToggleEnabled}
                    disabled={!account || account.status !== 'verified' || enableMutation.isPending}
                  />
                </div>
              </div>
              
              <div>
                <h3 className="font-medium mb-2">Danger Zone</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Delete all payment gateway configuration for this channel.
                </p>
                <Button 
                  variant="destructive" 
                  className="w-full"
                  onClick={handleDeleteConfiguration}
                  disabled={!account || deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete Configuration'}
                </Button>
              </div>
            </div>
          </Card>
          
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">About Tenant Payment Gateways</h2>
            
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">Tenant-owned credentials.</strong> Each academy configures their own Razorpay merchant account. Payments go directly to the tenant, not through Saa9vi.
              </p>
              
              <p>
                <strong className="text-foreground">Zero commission.</strong> Saa9vi does not take a percentage of tenant Razorpay transactions (Flow B).
              </p>
              
              <p>
                <strong className="text-foreground">Encrypted storage.</strong> Key secrets and webhook secrets are encrypted at rest using AES-256-GCM.
              </p>
              
              <p>
                <strong className="text-foreground">Channel-scoped.</strong> Configuration is tied to the active Vendure channel. SuperAdmin can view all accounts.
              </p>
              
              <p>
                <strong className="text-foreground">Verification required.</strong> Credentials must be verified via Razorpay API before the gateway can be enabled.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
