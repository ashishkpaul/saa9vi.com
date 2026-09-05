import { Badge, Page, PageBlock, PageLayout, PageTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vendure/dashboard';
import { api } from '@vendure/dashboard';
import { useQuery } from '@tanstack/react-query';

const GET_SPEND_REPORT = `
    query GetSpendReport($campaignId: ID!) {
        spendReport(campaignId: $campaignId) {
            id
            eventType
            amountInPaise
            occurredAt
            orderId
        }
    }
`;

function formatPaise(paise: number): string {
    return `₹${(paise / 100).toFixed(2)}`;
}

function formatDate(date: string): string {
    return new Date(date).toLocaleString();
}

export const spendReport = {
    path: '/ad-campaigns/$campaignId/spend',
    loader: () => ({ breadcrumb: 'Spend Report' }),
    component: (route: any) => {
        const params = route.useParams();
        const campaignId = params.campaignId;

        const { data, isLoading, error } = useQuery({
            queryKey: ['spendReport', campaignId],
            queryFn: () => api.query(GET_SPEND_REPORT, { campaignId }),
        });

        if (isLoading) {
            return (
                <Page>
                    <PageTitle>Spend Report</PageTitle>
                    <p className="text-muted-foreground">Loading spend data...</p>
                </Page>
            );
        }

        if (error) {
            return (
                <Page>
                    <PageTitle>Spend Report</PageTitle>
                    <p className="text-destructive">Error loading spend report: {(error as any).message}</p>
                </Page>
            );
        }

        const spendEntries = data?.spendReport ?? [];
        const totalSpent = spendEntries.reduce((sum: number, e: any) => sum + e.amountInPaise, 0);

        return (
            <Page>
                <PageTitle>
                    <div className="flex items-center gap-3">
                        <span>Spend Report</span>
                        <Badge variant="outline">Campaign {campaignId}</Badge>
                    </div>
                </PageTitle>

                <PageLayout>
                    <PageBlock column="main" blockId="spend-overview">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <div className="rounded-lg border p-4">
                                <p className="text-sm text-muted-foreground">Total Spent</p>
                                <p className="text-2xl font-bold">{formatPaise(totalSpent)}</p>
                            </div>
                            <div className="rounded-lg border p-4">
                                <p className="text-sm text-muted-foreground">Events</p>
                                <p className="text-2xl font-bold">{spendEntries.length}</p>
                            </div>
                        </div>

                        <h2 className="text-lg font-semibold mb-4">Spend Events</h2>

                        {spendEntries.length === 0 ? (
                            <p className="text-muted-foreground">
                                No spend events recorded for this campaign yet.
                            </p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Event Type</TableHead>
                                        <TableHead>Amount</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Order</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {spendEntries.map((entry: any) => (
                                        <TableRow key={entry.id}>
                                            <TableCell>
                                                <Badge variant="outline">{entry.eventType}</Badge>
                                            </TableCell>
                                            <TableCell className="text-red-600 font-medium">
                                                {formatPaise(entry.amountInPaise)}
                                            </TableCell>
                                            <TableCell>{formatDate(entry.occurredAt)}</TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {entry.orderId ?? '—'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}

                        <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
                            <p className="text-sm text-blue-800">
                                <strong>Note:</strong> Spend is deducted from your wallet balance. Ensure
                                sufficient wallet funds to keep campaigns running.
                            </p>
                        </div>
                    </PageBlock>
                </PageLayout>
            </Page>
        );
    },
};
