import { Injectable, Logger } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { SubscriptionProviderBinding } from '../../entities/subscription-provider-binding.entity';
import { OrganizationSubscription } from '../../entities/organization-subscription.entity';
import { ProviderWebhookEvent } from '../../entities/provider-webhook-event.entity';
import { SubscriptionService } from '../../services/subscription.service';
import { SubscriptionBillingAttemptService } from '../../services/subscription-billing-attempt.service';
import { SubscriptionRenewalService } from '../../services/subscription-renewal.service';
import { SubscriptionBillingAttempt, BillingAttemptStatus } from '../../entities/subscription-billing-attempt.entity';

const loggerCtx = 'RazorpayWebhookProcessor';

/**
 * ADR-041: Provider-cycle billing period identity.
 *
 * providerPeriodStart / providerPeriodEnd carry the Razorpay subscription
 * entity's current_start / current_end Unix timestamps converted to Date.
 * These are the authoritative source of truth for which billing cycle the
 * payment belongs to — local period arithmetic is explicitly prohibited for
 * provider-originated charge events.
 *
 * Saa9vi models recurring billing cycles at UTC calendar-date granularity;
 * provider timestamps are normalised to YYYY-MM-DD (UTC) before storage.
 *
 * providerPaidCount mirrors paid_count from the subscription entity;
 * useful for audit / reconciliation but not used in period identity logic.
 */
export interface NormalizedBillingEvent {
    eventType: string;
    providerEventId: string;
    providerSubscriptionId: string;
    providerPaymentId?: string;
    providerInvoiceId?: string;
    amountPaise?: number;
    currency?: string;
    status: string;
    channelId?: string;
    planId?: string;
    /** ADR-041 G2: provider billing cycle start (current_start → Date, UTC). */
    providerPeriodStart?: Date;
    /** ADR-041 G2: provider billing cycle end (current_end → Date, UTC). */
    providerPeriodEnd?: Date;
    /** ADR-041 G2: provider paid_count for audit/reconciliation. */
    providerPaidCount?: number;
    rawPayload: any;
}

/**
 * Thrown when a charge-bearing webhook event is missing the required
 * provider billing-cycle fields (current_start / current_end).
 *
 * Throwing (not returning false) is critical: the queue worker treats a
 * normal return as success and marks the ProviderWebhookEvent as
 * 'processed'. A missing cycle must instead activate the existing
 * retry / terminal-failure machinery so the event is re-queued and
 * ultimately surfaced as a failed inbox event requiring manual attention.
 */
export class MissingProviderCycleError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MissingProviderCycleError';
    }
}

@Injectable()
export class RazorpayWebhookProcessor {
    constructor(
        private connection: TransactionalConnection,
        private readonly subscriptionService: SubscriptionService,
        private readonly attemptService: SubscriptionBillingAttemptService,
        private readonly renewalService: SubscriptionRenewalService,
    ) {}

    /**
     * Process a webhook event from the immutable inbox.
     * Uses the authoritative event ID from the inbox record (x-razorpay-event-id header).
     * Resolves channel from SubscriptionProviderBinding, not arbitrary context.
     */
    async processInboxEvent(ctx: RequestContext, inboxEvent: ProviderWebhookEvent): Promise<void> {
        const providerEventId = inboxEvent.providerEventId;
        const event = inboxEvent.eventType;
        // Unwrap the Razorpay envelope: rawPayload is the full webhook body
        // { event, contains, payload }, while normalizeEvent expects the
        // inner payload object (C-1-E runtime finding).
        const payload = inboxEvent.rawPayload?.payload ?? inboxEvent.rawPayload;

        // REPLAY BOUNDARY (crash consistency): a TERMINAL attempt carrying
        // this event ID does NOT mean "done". For a 'succeeded' attempt the
        // finalization may not have completed (crash between the terminal
        // write and finalizeAfterPayment) — the finalize MUST be replayed
        // (it is replay-idempotent). Only a 'failed' terminal attempt is
        // fully complete. Handling this HERE (not inside recordAttempt)
        // guarantees the same-event retry path reaches the replay logic.
        const existingByEvent = await this.attemptService.findAttemptByProviderEventId('razorpay', providerEventId);
        if (existingByEvent && existingByEvent.status !== 'initiated') {
            await this.reconcileTerminalAttempt(existingByEvent, `event ${providerEventId} replay`);
            return;
        }

        const ne = this.normalizeEvent(event, payload, providerEventId);

        switch (event) {
            case 'subscription.pending':
                // Razorpay 'pending' = recurring payments are failing and provider
                // retries are in progress. Mirror on the binding AND bridge the
                // Saa9vi FSM to past_due so the dunning job can discover it
                // (RFC-001 §4.2). Do NOT record a billing attempt — no charge
                // event is attached to this state transition.
                //
                // ADR-041 G6: assertProviderCyclePresent throws before any domain
                // mutation if the failure cycle is absent, keeping the inbox event
                // in the retry queue.
                this.requireProviderCycleForFailure(ne, event);
                {
                    const b = await this.updateBinding(ctx, ne.providerSubscriptionId, 'razorpay', 'pending', false);
                    if (b?.subscription?.id) {
                        await this.renewalService.markPastDueFromWebhook(
                            b.subscription.id as string,
                            ne.providerPeriodStart,
                        );
                    }
                }
                Logger.log(`Subscription ${ne.providerSubscriptionId} is pending provider retry (dunning)`, loggerCtx);
                break;

            case 'subscription.authenticated':
                await this.updateBinding(ctx, ne.providerSubscriptionId, 'razorpay', 'authenticated', false);
                break;

            case 'subscription.activated':
                // ADR-041 fix: validate BEFORE any domain mutation.
                // If the activated event carries payment details, it is a
                // charge-bearing activation — the provider cycle is required.
                // Only then update the binding and record the attempt.
                //
                // Razorpay distinguishes authorization-only activations (future-start
                // subscriptions that produce 'authenticated' then later 'activated')
                // from immediately charged activations. The cycle guard only fires
                // when payment details are present (charge-bearing path).
                if (ne.providerPaymentId && ne.amountPaise) {
                    // Throws MissingProviderCycleError before any mutation if
                    // current_start / current_end are absent or invalid.
                    this.assertProviderCyclePresent(ne, event);
                }
                await this.updateBinding(ctx, ne.providerSubscriptionId, 'razorpay', 'active', true);
                if (ne.providerPaymentId && ne.amountPaise) {
                    await this.recordAttempt(ctx, ne, 'succeeded');
                }
                break;

            case 'subscription.charged':
                // ADR-041: validate cycle BEFORE any mutation.
                // subscription.charged always carries a payment and always requires
                // an authoritative provider cycle — the guard is unconditional.
                // Conditioning on providerPaymentId && amountPaise would allow a
                // malformed charged event to slip through without cycle validation,
                // violating INV-020's fail-closed requirement.
                this.assertProviderCyclePresent(ne, event);
                await this.recordAttempt(ctx, ne, 'succeeded');
                break;

            case 'subscription.halted':
                // Halted = retries exhausted, subscription suspended by provider.
                // ADR-041 G6: fail closed if cycle absent.
                this.requireProviderCycleForFailure(ne, event);
                {
                    const hb = await this.updateBinding(ctx, ne.providerSubscriptionId, 'razorpay', 'halted', false);
                    if (hb?.subscription?.id) {
                        await this.renewalService.markPastDueFromWebhook(
                            hb.subscription.id as string,
                            ne.providerPeriodStart,
                        );
                    }
                    if (ne.providerPaymentId && ne.amountPaise) {
                        await this.recordAttempt(ctx, ne, 'failed');
                    }
                }
                break;

            case 'subscription.cancelled':
                {
                    const cb = await this.updateBinding(ctx, ne.providerSubscriptionId, 'razorpay', 'cancelled', false);
                    if (cb?.subscription?.id) {
                        await this.renewalService.markCancelledFromWebhook(cb.subscription.id as string);
                    }
                }
                break;

            case 'payment.failed':
                if (ne.providerPaymentId) {
                    await this.recordAttempt(ctx, ne, 'failed');
                }
                break;

            case 'payment.charge_failed':
                if (ne.providerPaymentId) {
                    await this.recordAttempt(ctx, ne, 'failed');
                }
                break;

            default:
                // Unknown event types are persisted history, not failures.
                Logger.log(`Unhandled event type ${event} — marking PROCESSED (no-op)`, loggerCtx);
        }
    }

    /**
     * ADR-041 G2: Assert that a charge-bearing event carries a valid provider cycle.
     *
     * THROWS MissingProviderCycleError (not returns false) so the queue worker's
     * retry/terminal-failure machinery activates. A normal return would cause the
     * queue to mark the ProviderWebhookEvent as 'processed', silently losing the
     * event. The throw ensures the inbox event is re-queued and eventually surfaces
     * as a failed event requiring operator attention.
     *
     * Called BEFORE any domain mutation (binding update, attempt creation) so that
     * a malformed payload cannot produce partial state changes.
     */
    private assertProviderCyclePresent(ne: NormalizedBillingEvent, event: string): void {
        if (!ne.providerPeriodStart || !ne.providerPeriodEnd) {
            throw new MissingProviderCycleError(
                `${event} for subscription ${ne.providerSubscriptionId} is missing ` +
                    `provider cycle (current_start / current_end). ` +
                    `ADR-041: cannot finalize without authoritative billing period. ` +
                    `Event ${ne.providerEventId} requires manual reconciliation.`,
            );
        }
        if (ne.providerPeriodEnd <= ne.providerPeriodStart) {
            throw new MissingProviderCycleError(
                `${event} for subscription ${ne.providerSubscriptionId} has invalid cycle: ` +
                    `current_end (${ne.providerPeriodEnd.toISOString()}) ` +
                    `<= current_start (${ne.providerPeriodStart.toISOString()}). ` +
                    `Event ${ne.providerEventId} requires manual reconciliation.`,
            );
        }
    }

    /**
     * ADR-041 G6: Fail closed for provider failure events (pending / halted)
     * that arrive without cycle data.
     *
     * Only `providerPeriodStart` (Razorpay `current_start`) is required here.
     * G6's freshness guard compares cycle ordering:
     *
     *   providerCycleStart <= localCurrentPeriodStart → stale, no-op
     *   providerCycleStart >  localCurrentPeriodStart → newer unpaid cycle
     *
     * `providerPeriodEnd` is NOT required for this decision — the guard only
     * needs to know which cycle the failure belongs to, not when the cycle ends.
     * Contrast with G2/assertProviderCyclePresent which requires both fields
     * because it is establishing a billing period to finalize.
     *
     * Throws rather than returning so the inbox event stays in the retry queue.
     */
    private requireProviderCycleForFailure(ne: NormalizedBillingEvent, event: string): void {
        if (!ne.providerPeriodStart) {
            throw new MissingProviderCycleError(
                `${event} for subscription ${ne.providerSubscriptionId} is missing ` +
                    `provider cycle start (current_start). ` +
                    `ADR-041 G6: cannot evaluate cycle freshness without provider cycle. ` +
                    `Event ${ne.providerEventId} requires manual reconciliation.`,
            );
        }
    }

    /**
     * Update the SubscriptionProviderBinding status + active flag.
     *
     * ADR-041 G7: also persists providerStatus on the OrganizationSubscription
     * atomically in the same application-level transaction, so the subscription
     * mirror cannot diverge from the binding under any crash scenario.
     *
     * The binding lookup is provider-qualified (provider + providerSubscriptionId)
     * to match the UNIQUE(provider, providerSubscriptionId) index and the
     * provider-neutral architecture contract. Razorpay is the only active provider
     * today, but qualifying the lookup keeps the contract internally consistent.
     */
    private async updateBinding(
        ctx: RequestContext,
        subId: string,
        provider: string,
        status: string,
        active: boolean,
    ): Promise<SubscriptionProviderBinding | null> {
        // ADR-041 G7: wrap both writes in one application transaction so that
        // binding.providerStatus and subscription.providerStatus are either
        // both updated or both left unchanged. This eliminates the drift found
        // by the R2-E probe (binding = active, subscription = created).
        return this.connection.withTransaction(ctx, async (tCtx) => {
            const bindingRepo = this.connection.getRepository(tCtx, SubscriptionProviderBinding);
            // Fix 11: provider-qualified lookup to match the composite unique index.
            const binding = await bindingRepo.findOne({
                where: { provider, providerSubscriptionId: subId },
                relations: ['subscription'],
            });

            if (!binding) {
                Logger.warn(
                    `No provider binding found for provider=${provider} subscription=${subId}`,
                    loggerCtx,
                );
                return null;
            }

            binding.providerStatus = status;
            binding.active = active;
            await bindingRepo.save(binding);

            Logger.log(
                `Binding ${binding.id} for subscription ${subId} → status=${status}, active=${active}`,
                loggerCtx,
            );

            // ADR-041 G7: mirror providerStatus onto OrganizationSubscription
            // in the SAME transaction as the binding save.
            if (binding.subscription) {
                const subRepo = this.connection.getRepository(tCtx, OrganizationSubscription);
                binding.subscription.providerStatus = status;
                await subRepo.save(binding.subscription);
                Logger.log(
                    `OrganizationSubscription ${binding.subscription.id} providerStatus → ${status}`,
                    loggerCtx,
                );
            }

            // ADR-039: first-binding activation (defensive compat only — see below).
            if (active && binding.subscription?.status === 'pending_provider_auth') {
                const subRepo = this.connection.getRepository(tCtx, OrganizationSubscription);
                binding.subscription.status = 'active';
                await subRepo.save(binding.subscription);
                Logger.log(
                    `OrganizationSubscription ${binding.subscription.id} pending_provider_auth → active ` +
                        `(provider sub ${subId})`,
                    loggerCtx,
                );
            }

            return binding;
        });
    }

    /**
     * Record a billing attempt result from a provider webhook event.
     *
     * R2-F authority boundary: delegates ALL persistence to
     * SubscriptionBillingAttemptService — never calls attemptRepo directly.
     *
     * Reconciliation pattern (INV-019):
     *   1. Look for an existing 'initiated' attempt (renewal worker).
     *   2. If found → CAS-guarded terminal transition.
     *   3. If not found → create terminal attempt via recordAttemptFromWebhook.
     *
     * ADR-041 G3: providerPeriodStart / providerPeriodEnd are threaded into the
     * attempt row so finalizeAfterPayment() can reconstruct the provider cycle
     * on any replay without re-parsing the original payload.
     *
     * G3 failure semantics (ADR-041 §5):
     *   - For a succeeded attempt: cycle is always present (assertProviderCyclePresent
     *     already threw before reaching here if absent).
     *   - For a failed attempt transitioning an existing initiated row: pass
     *     undefined for both period fields so the terminal CAS explicitly stores
     *     NULL. No provisional local billing period is preserved — NULL is the
     *     correct uniform state for a failed attempt without provider-cycle identity.
     *   - For a webhook-only failed attempt with no cycle: omit billingPeriodStart/End
     *     entirely so the attempt does not carry a manufactured period identity.
     */
    private async recordAttempt(ctx: RequestContext, ne: NormalizedBillingEvent, status: BillingAttemptStatus): Promise<void> {
        const bindingRepo = this.connection.getRepository(ctx, SubscriptionProviderBinding);
        // Provider-qualified lookup (fix 11).
        const binding = await bindingRepo.findOne({
            where: { provider: 'razorpay', providerSubscriptionId: ne.providerSubscriptionId },
            relations: ['subscription'],
        });
        if (!binding) {
            Logger.warn(
                `No provider binding for razorpay subscription ${ne.providerSubscriptionId} — cannot record attempt`,
                loggerCtx,
            );
            return;
        }

        const channelId = ne.channelId || binding.channelId;
        const subscriptionId = binding.subscription.id;

        // ADR-041 G3: derive billing period from provider cycle.
        // For succeeded attempts, the cycle is always present (guard already fired).
        // For failed attempts, the cycle may be absent — handle below per path.
        const billingPeriodStart = ne.providerPeriodStart
            ? ne.providerPeriodStart.toISOString().split('T')[0]
            : undefined;
        const billingPeriodEnd = ne.providerPeriodEnd
            ? ne.providerPeriodEnd.toISOString().split('T')[0]
            : undefined;

        // Cross-event idempotency: terminal attempt already exists for this payment.
        if (ne.providerPaymentId) {
            const existing = await this.attemptService.findAttemptByProviderPaymentId(channelId, ne.providerPaymentId);
            if (existing && existing.status !== 'initiated') {
                await this.reconcileTerminalAttempt(existing, `payment ${ne.providerPaymentId} duplicate`);
                return;
            }
        }

        // Try to reconcile an existing 'initiated' attempt from the renewal worker.
        const existingAttempt = await this.attemptService.findInitiatedAttemptByProviderSubscriptionId(
            channelId,
            ne.providerSubscriptionId,
        );

        let attemptId: string;

        if (existingAttempt) {
            // Reconcile: transition the initiated attempt via the CAS-guarded service method.
            // ADR-041 G3: pass billingPeriodStart/End to overwrite the initiated row's
            // NULL fields with the authoritative provider cycle inside the same atomic CAS.
            // For failed attempts without a cycle: pass undefined so the terminal CAS
            // explicitly stores NULL for both period fields (uniform-NULL rule — no
            // provisional local date is preserved).
            if (status === 'succeeded') {
                const won = await this.attemptService.recordAttemptSuccess(
                    existingAttempt.id,
                    ne.providerPaymentId,
                    ne.providerEventId,
                    ne.providerInvoiceId,
                    billingPeriodStart,
                    billingPeriodEnd,
                );
                if (!won) {
                    Logger.log(
                        `Attempt ${existingAttempt.id} already left 'initiated' — CAS no-op for ${ne.eventType}`,
                        loggerCtx,
                    );
                    return;
                }
                attemptId = existingAttempt.id as string;
            } else {
                const won = await this.attemptService.recordAttemptFailure(
                    existingAttempt.id,
                    ne.status || 'charge_failed',
                    ne.providerPaymentId,
                    ne.providerEventId,
                    ne.providerInvoiceId,
                    billingPeriodStart,  // undefined when no cycle → NULL (uniform-NULL rule)
                    billingPeriodEnd,
                );
                if (!won) {
                    Logger.log(
                        `Attempt ${existingAttempt.id} already left 'initiated' — CAS no-op for ${ne.eventType}`,
                        loggerCtx,
                    );
                    return;
                }
                attemptId = existingAttempt.id as string;
            }
        } else {
            // Webhook-only charge (no preceding renewal-worker attempt).
            const invoiceId = ne.providerInvoiceId || (billingPeriodStart
                ? `INV-${subscriptionId}-${billingPeriodStart}`
                : `INV-${subscriptionId}-${ne.providerEventId}`);
            const amountPaise = ne.amountPaise || binding.subscription.plan.monthlyPriceInPaise || 0;
            try {
                const created = await this.attemptService.recordAttemptFromWebhook({
                    subscriptionId,
                    channelId,
                    invoiceId,
                    // For a succeeded webhook-only attempt, billingPeriodStart is always
                    // present (assertProviderCyclePresent fired before reaching here).
                    // For a failed webhook-only attempt without a provider cycle, pass
                    // undefined → NULL so the attempt carries no manufactured period
                    // identity (INV-020: billingPeriodStart is cycle identity, not
                    // a generic audit timestamp).
                    billingPeriodStart: billingPeriodStart,
                    billingPeriodEnd,
                    amountPaise,
                    currency: ne.currency,
                    provider: 'razorpay',
                    providerSubscriptionId: ne.providerSubscriptionId,
                    providerPaymentId: ne.providerPaymentId,
                    providerInvoiceId: ne.providerInvoiceId,
                    providerEventId: ne.providerEventId,
                    status,
                    failureReason: status === 'failed' ? (ne.status || 'charge_failed') : undefined,
                });
                attemptId = created.id as string;
            } catch (err: any) {
                if (err?.code === '23505' || String(err?.message || '').includes('UQ_billing_attempt_provider_payment')) {
                    Logger.log(
                        `Webhook-only attempt for payment ${ne.providerPaymentId} lost the concurrent-insert race — reconciling winner`,
                        loggerCtx,
                    );
                    const winner = await this.attemptService.findAttemptByProviderPaymentId(channelId, ne.providerPaymentId!);
                    if (winner) {
                        await this.reconcileTerminalAttempt(winner, `unique-race loser for payment ${ne.providerPaymentId}`);
                    }
                    return;
                }
                throw err;
            }
        }

        // On successful charge, finalize the subscription period.
        if (status === 'succeeded') {
            const result = await this.renewalService.finalizeAfterPayment(attemptId);
            if (result !== 'SUCCESS') {
                Logger.warn(
                    `Finalize-after-payment for attempt ${attemptId} returned ${result} — ` +
                        `subscription ${subscriptionId} period may need manual reconciliation`,
                    loggerCtx,
                );
            }
        }
    }

    /**
     * Shared terminal-attempt reconciliation.
     *
     * SINGLE authority for "this charge already has a terminal attempt":
     *   terminal succeeded → finalization may be incomplete (crash between
     *     terminal write and finalize) → replay finalizeAfterPayment, which
     *     is replay-idempotent via the cycle-monotonic CAS.
     *   terminal failed → fully complete, nothing to finalize.
     */
    private async reconcileTerminalAttempt(attempt: SubscriptionBillingAttempt, via: string): Promise<void> {
        if (attempt.status === 'succeeded') {
            Logger.log(
                `Terminal succeeded attempt ${attempt.id} (${via}) — replaying finalize (idempotent)`,
                loggerCtx,
            );
            const result = await this.renewalService.finalizeAfterPayment(attempt.id as string);
            if (result !== 'SUCCESS') {
                Logger.warn(
                    `Finalize replay for attempt ${attempt.id} (${via}) returned ${result} — manual reconciliation may be required`,
                    loggerCtx,
                );
            }
            return;
        }
        Logger.log(
            `Terminal attempt ${attempt.id} (status=${attempt.status}) (${via}) — fully complete, no-op`,
            loggerCtx,
        );
    }

    /**
     * Normalize a raw Razorpay webhook payload into a common billing event shape.
     *
     * ADR-041 G2: extracts current_start / current_end / paid_count from the
     * Razorpay subscription entity. Razorpay sends these as Unix timestamps
     * (seconds, epoch). They are the authoritative provider billing cycle.
     *
     * UTC date granularity: Saa9vi models billing cycles as YYYY-MM-DD strings
     * (UTC). The conversion happens here (toISOString().split('T')[0]) so all
     * downstream code operates on the same granularity assumption.
     *
     * Razorpay sends:
     *   { event, contains, payload: { subscription: { entity }, payment?: { entity } } }
     */
    private normalizeEvent(event: string, payload: any, eventId: string): NormalizedBillingEvent {
        const subscriptionEntity = payload?.subscription?.entity ?? payload?.subscription ?? {};
        const paymentEntity = payload?.payment?.entity ?? payload?.payment ?? {};
        const charge = paymentEntity;

        const subId: string | undefined = subscriptionEntity.id;

        const paymentId: string | undefined = paymentEntity.id || charge?.id;
        const invoiceId: string | undefined = paymentEntity.invoice_id || charge?.invoice_id;
        const amountPaise: number | undefined = charge?.amount || paymentEntity.amount;
        const currency: string | undefined = charge?.currency || paymentEntity.currency;
        const status: string = charge?.status || paymentEntity.status || 'unknown';

        // ADR-041 G2: extract provider billing cycle.
        // current_start = 0 is not a valid billing cycle start.
        const rawStart: number | undefined = subscriptionEntity.current_start;
        const rawEnd: number | undefined = subscriptionEntity.current_end;

        const providerPeriodStart: Date | undefined =
            rawStart && rawStart > 0 ? new Date(rawStart * 1000) : undefined;
        const providerPeriodEnd: Date | undefined =
            rawEnd && rawEnd > 0 ? new Date(rawEnd * 1000) : undefined;

        const providerPaidCount: number | undefined = subscriptionEntity.paid_count;

        return {
            eventType: event,
            providerEventId: eventId,
            providerSubscriptionId: subId || '',
            providerPaymentId: paymentId,
            providerInvoiceId: invoiceId,
            amountPaise,
            currency,
            status,
            channelId: subscriptionEntity.notes?.channelId,
            planId: subscriptionEntity.notes?.planId,
            providerPeriodStart,
            providerPeriodEnd,
            providerPaidCount,
            rawPayload: payload,
        };
    }
}
