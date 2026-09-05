import { Badge, Page, PageBlock, PageLayout, PageTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';
import { api } from '@vendure/dashboard';
import { useQuery } from '@tanstack/react-query';

const GET_WALLET_DATA = `
    query GetWalletData {
        walletBalance
        walletLedger {
            id
            type
            amountInPaise
            occurredAt
            campaignId
            orderId
            reference
        }
    }
`;

const TYPE_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'destructive'> = {
    topup: 'success',
    spend: 'destructive',
    refund: 'secondary',
};

function formatPaise(paise: number): string {
    return `₹${(paise / 100).toFixed(2)}`;
}

function formatDate(date: string): string {
    return new Date(date).toLocaleString();
}

export const walletPage = {
    navMenuItem: {
        sectionId: 'marketplace',
        id: 'ad-wallet',
        url: '/ad-wallet',
        title: 'Wallet',
        requiresPermission: ['MarketplaceAdvertising_Read'],
    },
    path: '/ad-wallet',
    loader: () => ({ breadcrumb: 'Ad Wallet' }),
    component: () => {
        const { data, isLoading, error } = useQuery({
            queryKey: ['walletData'],
            queryFn: () => api.query(GET_WALLET_DATA),
        });

        if (isLoading) {
            return (
                <Page>
                    <PageTitle>Wallet</PageTitle>
                    <p className="text-muted-foreground">Loading wallet data...</p>
                </Page>
            );
        }

        if (error) {
            return (
                <Page>
                    <PageTitle>Wallet</PageTitle>
                    <p className="text-destructive">Error loading wallet: {(error as any).message}</p>
                </Page>
            );
        }

        const balance = data?.walletBalance ?? 0;
        const ledger = data?.walletLedger ?? [];

        return (
            <Page>
                <PageTitle>Ad Wallet</PageTitle>

                <PageLayout>
                    <PageBlock column="main" blockId="balance-overview">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <div className="rounded-lg border p-4">
                                <p className="text-sm text-muted-foreground">Current Balance</p>
                                <p className="text-2xl font-bold">{formatPaise(balance)}</p>
                            </div>
                        </div>

                        <h2 className="text-lg font-semibold mb-4">Transaction History</h2>

                        {ledger.length === 0 ? (
                            <p className="text-muted-foreground">
                                No transactions yet. Wallet credit is added via payment settlement.
                            </p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Amount</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Reference</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {ledger.map((entry: any) => (
                                        <TableRow key={entry.id}>
                                            <TableCell>
                                                <Badge variant={TYPE_VARIANT[entry.type] ?? 'outline'}>
                                                    {entry.type}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className={
                                                entry.type === 'topup' || entry.type === 'refund'
                                                    ? 'text-green-600 font-medium'
                                                    : 'text-red-600 font-medium'
                                            }>
                                                {entry.type === 'topup' || entry.type === 'refund' ? '+' : ''}
                                                {formatPaise(entry.amountInPaise)}
                                            </TableCell>
                                            <TableCell>{formatDate(entry.occurredAt)}</TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {entry.reference ?? entry.orderId ?? entry.campaignId ?? '—'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}

                        <div className="mt-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                            <p className="text-sm text-yellow-800">
                                <strong>Note:</strong> Wallet credit is only available after a verified payment
                                settlement. Contact support to add funds to your wallet.
                            </p>
                        </div>
                    </PageBlock>
                </PageLayout>
            </Page>
        );
    },
};
