import { describe, it, expect } from 'vitest';
import {
    extractRazorpayFailure,
    isNoActiveCycleFailure,
    toProviderError,
    NO_ACTIVE_CYCLE_DESCRIPTION,
    RAZORPAY_BAD_REQUEST_CODE,
} from '../razorpay-error.mapper';
import {
    ProviderSubscriptionNoActiveCycleError,
    RecurringBillingProviderError,
    PROVIDER_SUBSCRIPTION_NO_ACTIVE_CYCLE,
} from '../../recurring-billing.provider';

describe('razorpay-error.mapper', () => {
    describe('extractRazorpayFailure', () => {
        it('extracts from observed SDK shape { statusCode, error: { code, description } }', () => {
            const raw = {
                statusCode: 400,
                error: {
                    code: 'BAD_REQUEST_ERROR',
                    description: NO_ACTIVE_CYCLE_DESCRIPTION,
                },
            };
            const extracted = extractRazorpayFailure(raw);
            expect(extracted.statusCode).toBe(400);
            expect(extracted.providerCode).toBe('BAD_REQUEST_ERROR');
            expect(extracted.description).toBe(NO_ACTIVE_CYCLE_DESCRIPTION);
        });

        it('extracts from Axios-style { response: { status, data: { error: { code, description } } } }', () => {
            const raw = {
                response: {
                    status: 400,
                    data: {
                        error: {
                            code: 'BAD_REQUEST_ERROR',
                            description: NO_ACTIVE_CYCLE_DESCRIPTION,
                        },
                    },
                },
            };
            const extracted = extractRazorpayFailure(raw);
            expect(extracted.statusCode).toBe(400);
            expect(extracted.providerCode).toBe('BAD_REQUEST_ERROR');
            expect(extracted.description).toBe(NO_ACTIVE_CYCLE_DESCRIPTION);
        });

        it('handles null/undefined/primitive gracefully', () => {
            expect(extractRazorpayFailure(null)).toEqual({
                providerCode: undefined,
                description: undefined,
                statusCode: undefined,
            });
            expect(extractRazorpayFailure('string error')).toEqual({
                providerCode: undefined,
                description: undefined,
                statusCode: undefined,
            });
            expect(extractRazorpayFailure(undefined)).toEqual({
                providerCode: undefined,
                description: undefined,
                statusCode: undefined,
            });
        });
    });

    describe('isNoActiveCycleFailure', () => {
        it('returns true for exact BAD_REQUEST_ERROR + description + 400', () => {
            expect(
                isNoActiveCycleFailure({
                    providerCode: RAZORPAY_BAD_REQUEST_CODE,
                    description: NO_ACTIVE_CYCLE_DESCRIPTION,
                    statusCode: 400,
                }),
            ).toBe(true);
        });

        it('returns true when statusCode is undefined but description matches', () => {
            expect(
                isNoActiveCycleFailure({
                    providerCode: RAZORPAY_BAD_REQUEST_CODE,
                    description: NO_ACTIVE_CYCLE_DESCRIPTION,
                    statusCode: undefined,
                }),
            ).toBe(true);
        });

        it('returns false when description differs', () => {
            expect(
                isNoActiveCycleFailure({
                    providerCode: RAZORPAY_BAD_REQUEST_CODE,
                    description: 'Subscription is already cancelled',
                    statusCode: 400,
                }),
            ).toBe(false);
        });

        it('returns false for other status codes e.g. 500', () => {
            expect(
                isNoActiveCycleFailure({
                    providerCode: RAZORPAY_BAD_REQUEST_CODE,
                    description: NO_ACTIVE_CYCLE_DESCRIPTION,
                    statusCode: 500,
                }),
            ).toBe(false);
        });
    });

    describe('toProviderError', () => {
        it('maps no-active-cycle payload to ProviderSubscriptionNoActiveCycleError', () => {
            const raw = {
                statusCode: 400,
                error: {
                    code: 'BAD_REQUEST_ERROR',
                    description: NO_ACTIVE_CYCLE_DESCRIPTION,
                },
            };
            const err = toProviderError(raw, 'razorpay', 'cancelSubscription');
            expect(err).toBeInstanceOf(ProviderSubscriptionNoActiveCycleError);
            expect(err).toBeInstanceOf(RecurringBillingProviderError);
            expect(err.provider).toBe('razorpay');
            expect(err.operation).toBe('cancelSubscription');
            expect(err.providerCode).toBe('BAD_REQUEST_ERROR');
            expect(err.statusCode).toBe(400);
            expect((err as ProviderSubscriptionNoActiveCycleError).code).toBe(
                PROVIDER_SUBSCRIPTION_NO_ACTIVE_CYCLE,
            );
        });

        it('maps unknown provider error to general RecurringBillingProviderError without raw leaks', () => {
            const raw = {
                statusCode: 401,
                error: {
                    code: 'GATEWAY_ERROR',
                    description: 'Invalid credentials or secret',
                },
                secretPayload: 'super-secret',
            };
            const err = toProviderError(raw, 'razorpay', 'createSubscription');
            expect(err).toBeInstanceOf(RecurringBillingProviderError);
            expect(err).not.toBeInstanceOf(ProviderSubscriptionNoActiveCycleError);
            expect(err.message).toBe(
                'Recurring billing provider operation failed (razorpay:createSubscription)',
            );
            expect(err.provider).toBe('razorpay');
            expect(err.operation).toBe('createSubscription');
            expect(err.providerCode).toBe('GATEWAY_ERROR');
            expect(err.statusCode).toBe(401);
            expect((err as any).secretPayload).toBeUndefined();
        });
    });
});
