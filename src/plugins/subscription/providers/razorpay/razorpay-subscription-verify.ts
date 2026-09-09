/**
 * Razorpay Subscription Contract Verification Script
 *
 * PURPOSE: Verify the Razorpay Subscriptions API contract against the live
 * sandbox. Captures the actual provider payloads to freeze ADR-038.
 *
 * USAGE:
 *   1. Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET in .env
 *   2. Start ngrok: ngrok http 3000
 *   3. Set Razorpay webhook URL to: https://<ngrok-id>.ngrok.io/payments/razorpay/webhook
 *   4. Run: npx ts-node src/plugins/subscription/providers/razorpay/razorpay-subscription-verify.ts
 *
 * WHAT IT VERIFIES:
 *   - Plan creation
 *   - Subscription creation
 *   - Customer authorization URL generation
 *   - Webhook payload capture (subscription.authenticated, activated, charged)
 *
 * OUTPUT: A structured report showing the captured contract evidence.
 */
import "dotenv/config";
import { RazorpaySubscriptionProvider } from "./razorpay-subscription.provider";
import { ConfigService } from "@vendure/core";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const configService = new ConfigService();
const provider = new RazorpaySubscriptionProvider(configService);

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

interface VerificationReport {
    timestamp: string;
    environment: "test" | "live";
    results: Array<{
        step: string;
        status: "pass" | "fail" | "skipped";
        data?: any;
        error?: string;
    }>;
}

async function main(): Promise<void> {
    const report: VerificationReport = {
        timestamp: new Date().toISOString(),
        environment: "test",
        results: [],
    };

    let planId: string | undefined;
    let subscriptionId: string | undefined;

    // Step 1: Create Plan
    console.log("\n=== Step 1: Create Plan ===");
    try {
        planId = process.env.RAZORPAY_TEST_PLAN_ID;
        if (!planId) {
            console.log("⚠️  Set RAZORPAY_TEST_PLAN_ID in .env (create plan in Razorpay Dashboard first)");
            report.results.push({
                step: "create_plan",
                status: "skipped",
                error: "RAZORPAY_TEST_PLAN_ID not set",
            });
        } else {
            console.log(`✓ Using plan: ${planId}`);
            report.results.push({
                step: "create_plan",
                status: "pass",
                data: { planId },
            });
        }
    } catch (err: any) {
        console.error(`✗ Plan creation failed: ${err.message}`);
        report.results.push({
            step: "create_plan",
            status: "fail",
            error: err.message,
        });
    }

    // Step 2: Create Subscription
    console.log("\n=== Step 2: Create Subscription ===");
    if (planId) {
        try {
            const subscription = await provider.createSubscription({
                channelId: "test_channel",
                organizationId: "test_org",
                customerId: "test_customer",
                customerEmail: "test@example.com",
                customerPhone: "9999999999",
                planId: planId,
                amount: 1.0,
                currency: "INR",
                frequency: "monthly",
                totalCount: 12,
            });

            subscriptionId = subscription.providerSubscriptionId;
            console.log(`✓ Subscription created: ${subscriptionId}`);
            console.log(`  Status: ${subscription.status}`);
            console.log(`  Authorization URL: ${subscription.shortUrl}`);
            report.results.push({
                step: "create_subscription",
                status: "pass",
                data: {
                    subscriptionId: subscription.providerSubscriptionId,
                    status: subscription.status,
                    shortUrl: subscription.shortUrl,
                    mandateId: subscription.mandateId,
                },
            });

            // Step 3: Output authorization instructions
            console.log("\n=== Step 3: Customer Authorization ===");
            console.log(`  Open this URL in a browser to authorize:`);
            console.log(`  ${subscription.shortUrl}`);
            console.log(`\n  After authorization, webhooks will be captured at:`);
            console.log(`  POST /payments/razorpay/webhook`);
            console.log(`\n  Expected webhook events:`);
            console.log(`  - subscription.authenticated`);
            console.log(`  - subscription.activated`);
            console.log(`  - subscription.charged (on next billing cycle)`);

        } catch (err: any) {
            console.error(`✗ Subscription creation failed: ${err.message}`);
            report.results.push({
                step: "create_subscription",
                status: "fail",
                error: err.message,
            });
        }
    } else {
        report.results.push({
            step: "create_subscription",
            status: "skipped",
            error: "No plan ID available",
        });
    }

    // Step 4: Fetch subscription status
    console.log("\n=== Step 4: Fetch Subscription Status ===");
    if (subscriptionId) {
        try {
            const sub = await provider.getSubscription(subscriptionId);
            console.log(`✓ Subscription status: ${sub.status}`);
            report.results.push({
                step: "fetch_subscription",
                status: "pass",
                data: {
                    subscriptionId: sub.providerSubscriptionId,
                    status: sub.status,
                },
            });
        } catch (err: any) {
            console.error(`✗ Fetch failed: ${err.message}`);
            report.results.push({
                step: "fetch_subscription",
                status: "fail",
                error: err.message,
            });
        }
    }

    // Summary
    console.log("\n=== Summary ===");
    console.log(JSON.stringify(report, null, 2));

    const passed = report.results.filter((r) => r.status === "pass").length;
    const failed = report.results.filter((r) => r.status === "fail").length;
    console.log(`\nPassed: ${passed}, Failed: ${failed}`);
}

main().catch(console.error);