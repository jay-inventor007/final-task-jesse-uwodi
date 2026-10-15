/**
 * Payday Prototype — Distributed Saga Orchestrator
 * Coordinates multi-step, multi-currency contractor payouts without 2PC.
 * Executes forward transactions and automatic compensating reversal entries.
 */

import { LedgerEngine } from './ledger';
import { RailRouter, PayoutDestination } from './railRouter';
import { TransactionalOutbox } from './outbox';

export type SagaState = 
  | 'INITIATED' 
  | 'FUNDS_LOCKED' 
  | 'DISPATCHED_TO_RAIL' 
  | 'SETTLED' 
  | 'COMPENSATING' 
  | 'COMPENSATED_REFUNDED';

export interface PayoutRequest {
  idempotencyKey: string;
  tenantId: string;
  sourceAccountId: string;
  amountMinorUnits: number;
  currency: string;
  destination: PayoutDestination;
}

export interface PayoutSaga {
  payoutId: string;
  idempotencyKey: string;
  tenantId: string;
  amountMinorUnits: number;
  currency: string;
  railCode: string;
  state: SagaState;
  bankReference?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class SagaOrchestrator {
  private sagas: Map<string, PayoutSaga> = new Map();
  private idempotencyRegistry: Map<string, PayoutSaga> = new Map();

  constructor(
    private readonly ledger: LedgerEngine,
    private readonly railRouter: RailRouter,
    private readonly outbox: TransactionalOutbox,
    private readonly clearingAccountId: string,
    private readonly externalSettlementAccountId: string
  ) {}

  async processPayout(req: PayoutRequest): Promise<PayoutSaga> {
    // 1. IDEMPOTENT CONSUMER PATTERN: Check if already submitted
    const existing = this.idempotencyRegistry.get(req.idempotencyKey);
    if (existing) {
      console.log(`[Idempotency Hit] Replaying existing saga for key: ${req.idempotencyKey}`);
      return existing;
    }

    const payoutId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const strategy = this.railRouter.getStrategy(req.currency, req.destination.country);

    const saga: PayoutSaga = {
      payoutId,
      idempotencyKey: req.idempotencyKey,
      tenantId: req.tenantId,
      amountMinorUnits: req.amountMinorUnits,
      currency: req.currency,
      railCode: strategy.railCode,
      state: 'INITIATED',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.sagas.set(payoutId, saga);
    this.idempotencyRegistry.set(req.idempotencyKey, saga);

    // 2. FORWARD STEP 1: Lock Employer Funds in Double-Entry Ledger
    try {
      const employerBalance = this.ledger.getBalance(req.sourceAccountId);
      if (employerBalance < req.amountMinorUnits) {
        saga.state = 'COMPENSATED_REFUNDED';
        saga.errorMessage = `INSUFFICIENT_FUNDS: Available ${employerBalance}, required ${req.amountMinorUnits}`;
        saga.updatedAt = new Date();
        return saga;
      }

      // Atomic Ledger Entry: Debit Employer Liability, Credit Clearing Account
      this.ledger.recordJournalEntry(
        `HOLD_${payoutId}`,
        `Reserve contractor payout funds for ${req.destination.beneficiaryName}`,
        [
          { accountId: req.sourceAccountId, amountMinorUnits: -req.amountMinorUnits, direction: 'DEBIT' },
          { accountId: this.clearingAccountId, amountMinorUnits: req.amountMinorUnits, direction: 'CREDIT' }
        ]
      );

      saga.state = 'FUNDS_LOCKED';
      saga.updatedAt = new Date();

      // Record in Transactional Outbox
      this.outbox.recordEvent('PAYOUT_SAGA', payoutId, 'FUNDS_LOCKED', {
        payoutId,
        amount: req.amountMinorUnits,
        currency: req.currency
      });

    } catch (err: any) {
      saga.state = 'COMPENSATED_REFUNDED';
      saga.errorMessage = `LEDGER_HOLD_FAILED: ${err.message}`;
      return saga;
    }

    // 3. FORWARD STEP 2: Dispatch to External Banking Rail Strategy
    saga.state = 'DISPATCHED_TO_RAIL';
    saga.updatedAt = new Date();

    try {
      const railResult = await strategy.executeTransfer(payoutId, req.amountMinorUnits, req.destination);

      if (railResult.success) {
        // STEP 3A (SUCCESS): Finalize Ledger Settlement
        this.ledger.recordJournalEntry(
          `SETTLE_${payoutId}`,
          `Settle external disbursement reference ${railResult.bankReference}`,
          [
            { accountId: this.clearingAccountId, amountMinorUnits: -req.amountMinorUnits, direction: 'DEBIT' },
            { accountId: this.externalSettlementAccountId, amountMinorUnits: req.amountMinorUnits, direction: 'CREDIT' }
          ]
        );

        saga.state = 'SETTLED';
        saga.bankReference = railResult.bankReference;
        saga.updatedAt = new Date();

        this.outbox.recordEvent('PAYOUT_SAGA', payoutId, 'SETTLED', {
          payoutId,
          bankReference: railResult.bankReference
        });

        return saga;
      } else {
        throw new Error(railResult.errorMessage || 'Bank rail returned failure');
      }

    } catch (railErr: any) {
      // 4. STEP 3B (COMPENSATION PATH): Trigger Compensating Transaction
      console.warn(`[Saga Compensating] Rail failed for payout ${payoutId}: ${railErr.message}`);
      saga.state = 'COMPENSATING';
      saga.errorMessage = railErr.message;
      saga.updatedAt = new Date();

      // Compensating Journal Entry: Reverse the funds lock
      // Credit Employer Liability, Debit Clearing Account
      this.ledger.recordJournalEntry(
        `COMPENSATE_${payoutId}`,
        `Compensation reversal: refund failed payout ${payoutId} back to employer`,
        [
          { accountId: this.clearingAccountId, amountMinorUnits: -req.amountMinorUnits, direction: 'DEBIT' },
          { accountId: req.sourceAccountId, amountMinorUnits: req.amountMinorUnits, direction: 'CREDIT' }
        ]
      );

      saga.state = 'COMPENSATED_REFUNDED';
      saga.updatedAt = new Date();

      this.outbox.recordEvent('PAYOUT_SAGA', payoutId, 'COMPENSATED_REFUNDED', {
        payoutId,
        reason: railErr.message
      });

      return saga;
    }
  }

  getSaga(payoutId: string): PayoutSaga | undefined {
    return this.sagas.get(payoutId);
  }
}
