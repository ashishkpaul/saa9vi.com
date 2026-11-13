import { Card } from '@vendure/dashboard';
import { ReactNode } from 'react';

interface PaymentGatewayPageHeaderProps {
  title: string;
  description: string;
  children?: ReactNode;
}

/**
 * Standard page header for payment gateway configuration pages
 */
export function PaymentGatewayPageHeader({ title, description, children }: PaymentGatewayPageHeaderProps) {
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {children}
        </div>
      </div>
    </div>
  );
}

interface StatusBadgeProps {
  status: 'not-configured' | 'pending' | 'active' | 'disabled';
}

/**
 * Status badge for displaying account status
 */
export function PaymentGatewayStatusBadge({ status }: StatusBadgeProps) {
  const config = {
    'not-configured': { label: 'Not configured', color: 'bg-gray-100 text-gray-800 border-gray-200' },
    'pending': { label: 'Pending verification', color: 'bg-amber-100 text-amber-800 border-amber-200' },
    'active': { label: 'Active', color: 'bg-green-100 text-green-800 border-green-200' },
    'disabled': { label: 'Disabled', color: 'bg-gray-100 text-gray-800 border-gray-200' },
  };

  const { label, color } = config[status];

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

/**
 * Loading skeleton for payment gateway configuration
 */
export function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-1/4 bg-gray-200 rounded animate-pulse" />
          <div className="h-10 bg-gray-100 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/**
 * Info card for displaying connection status and metadata
 */
export function ConnectionStatusCard({ title, status, description, children }: {
  title: string;
  status: 'success' | 'warning' | 'error' | 'neutral';
  description: string;
  children?: ReactNode;
}) {
  const statusConfig = {
    success: { icon: '✓', color: 'border-green-200 bg-green-50' },
    warning: { icon: '⚠', color: 'border-amber-200 bg-amber-50' },
    error: { icon: '✗', color: 'border-red-200 bg-red-50' },
    neutral: { icon: 'ⓘ', color: 'border-gray-200 bg-gray-50' },
  };

  const { icon, color } = statusConfig[status];

  return (
    <Card className={`p-4 border ${color}`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-white border text-sm">
          {icon}
        </div>
        <div className="flex-1">
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </Card>
  );
}
