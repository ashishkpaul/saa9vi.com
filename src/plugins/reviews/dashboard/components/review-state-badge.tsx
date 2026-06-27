import { Badge } from '@vendure/dashboard';

const STATE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    approved: 'default',
    new: 'secondary',
    rejected: 'destructive',
    hidden: 'outline',
    flagged: 'destructive',
};

export function ReviewStateBadge({ state }: { state?: string | null }) {
    const normalized = state ?? 'new';
    return <Badge variant={STATE_VARIANT[normalized] ?? 'secondary'}>{normalized}</Badge>;
}