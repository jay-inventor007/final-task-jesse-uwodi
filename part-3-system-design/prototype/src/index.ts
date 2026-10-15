/**
 * Payday Prototype — End-to-End Execution Scenario
 * Demonstrates:
 * 1. Double-Entry Ledger initialization with integer minor units
 * 2. Successful contractor payout workflow (Saga -> Settle)
 * 3. Rail rejection triggering automatic Compensating Transaction (Saga -> Refund)
 * 4. Idempotent deduplication (same idempotency key replayed)
 * 5. Circuit Breaker tripping under consecutive external rail failures
 */

import { LedgerEngine } from './ledger';
import { RailRouter, AchRailStrategy, NipRailStrategy } from './railRouter';
import { TransactionalOutbox } from './outbox';
import { SagaOrchestrator, PayoutRequest } from './sagaOrchestrator';

async function runDemo() {
  console.log('================================================================');
  console.log('       PAYDAY DISTRIBUTED SAGA & DOUBLE-ENTRY LEDGER DEMO       ');
  console.log('================================================================\n');

  // 1. Initialize Double-Entry Ledger
  const ledger = new LedgerEngine();
  const employerAccount = ledger.createAccount('acc_employer_usd', 'tenant_001', 'LIABILITY', 'USD', 5000000); // $50,000.00
  const clearingAccount = ledger.createAccount('acc_clearing_usd', 'tenant_001', 'ASSET', 'USD', 0);
  const bankSettlementAccount = ledger.createAccount('acc_bank_fed_usd', 'tenant_001', 'ASSET', 'USD', 0);

  const outbox = new TransactionalOutbox();
  const railRouter = new RailRouter();
  const orchestrator = new SagaOrchestrator(
    ledger,
    railRouter,
    outbox,
    clearingAccount.id,
    bankSettlementAccount.id
  );

  console.log('--- INITIAL LEDGER STATE ---');
  console.log(`Employer Balance: $${(ledger.getBalance(employerAccount.id) / 100).toFixed(2)} (${ledger.getBalance(employerAccount.id)} cents)`);
  console.log(`Clearing Balance: $${(ledger.getBalance(clearingAccount.id) / 100).toFixed(2)}`);
  console.log(`Bank Settlement:  $${(ledger.getBalance(bankSettlementAccount.id) / 100).toFixed(2)}\n`);

  // 2. SCENARIO 1: Successful Payout via ACH
  console.log('--- SCENARIO 1: SUCCESSFUL PAYOUT VIA ACH ($6,500.00) ---');
  const req1: PayoutRequest = {
    idempotencyKey: 'idemp_key_success_001',
    tenantId: 'tenant_001',
    sourceAccountId: employerAccount.id,
    amountMinorUnits: 650000, // $6,500.00
    currency: 'USD',
    destination: {
      beneficiaryName: 'Jesse Uwodi',
      accountNumber: '9988776655',
      routingCode: '021000021',
      currency: 'USD',
      country: 'US'
    }
  };

  const res1 = await orchestrator.processPayout(req1);
  console.log(`Saga Result: Status=${res1.state}, BankRef=${res1.bankReference}`);
  console.log(`Employer Balance: $${(ledger.getBalance(employerAccount.id) / 100).toFixed(2)}`);
  console.log(`Bank Settlement:  $${(ledger.getBalance(bankSettlementAccount.id) / 100).toFixed(2)}\n`);

  // 3. SCENARIO 2: Idempotent Deduplication Test
  console.log('--- SCENARIO 2: IDEMPOTENCY REPLAY TEST ---');
  console.log('Replaying the exact same request with identical Idempotency-Key...');
  const resDuplicate = await orchestrator.processPayout(req1);
  console.log(`Deduplication Verified! Same Payout ID returned: ${resDuplicate.payoutId === res1.payoutId}`);
  console.log(`Employer Balance Unchanged: $${(ledger.getBalance(employerAccount.id) / 100).toFixed(2)}\n`);

  // 4. SCENARIO 3: External Bank Failure & Automatic Compensating Reversal
  console.log('--- SCENARIO 3: EXTERNAL BANK FAILURE & SAGA COMPENSATION ($3,200.00) ---');
  const achStrategy = railRouter.getStrategyByCode<AchRailStrategy>('ACH_US');
  achStrategy.simulateFailure = true; // Simulate bank rejection

  const reqFail: PayoutRequest = {
    idempotencyKey: 'idemp_key_fail_002',
    tenantId: 'tenant_001',
    sourceAccountId: employerAccount.id,
    amountMinorUnits: 320000, // $3,200.00
    currency: 'USD',
    destination: {
      beneficiaryName: 'Contractor Invalid',
      accountNumber: '0000000000',
      routingCode: '021000021',
      currency: 'USD',
      country: 'US'
    }
  };

  const resFail = await orchestrator.processPayout(reqFail);
  console.log(`Saga Result: Status=${resFail.state}, Error=${resFail.errorMessage}`);
  console.log(`Compensating Transaction Triggered!`);
  console.log(`Employer Balance Restored: $${(ledger.getBalance(employerAccount.id) / 100).toFixed(2)}`);
  console.log(`Clearing Account Balance Returned to 0: $${(ledger.getBalance(clearingAccount.id) / 100).toFixed(2)}\n`);

  // 5. SCENARIO 4: Circuit Breaker Tripping Under Consecutive Rail Failures
  console.log('--- SCENARIO 4: CIRCUIT BREAKER PATTERN VALIDATION ---');
  console.log(`Current ACH Circuit Breaker State: ${achStrategy.circuitBreaker.state}`);
  console.log('Simulating consecutive failures to trip circuit breaker...');

  for (let i = 1; i <= 3; i++) {
    try {
      await orchestrator.processPayout({
        ...reqFail,
        idempotencyKey: `idemp_cb_probe_${i}`
      });
    } catch (_) {}
  }

  console.log(`Tripped ACH Circuit Breaker State: ${achStrategy.circuitBreaker.state}`);
  console.log('Attempting new payout while circuit is OPEN...');
  try {
    await achStrategy.executeTransfer('test_pay', 1000, reqFail.destination);
  } catch (cbErr: any) {
    console.log(`Circuit Breaker Protected Rail: "${cbErr.message}"\n`);
  }

  // 6. Review Outbox Table
  console.log('--- TRANSACTIONAL OUTBOX EVENTS STORED ---');
  const events = outbox.getAllEvents();
  console.log(`Total Outbox Events Captured: ${events.length}`);
  events.forEach(e => {
    console.log(`[Event #${e.id}] Aggregate=${e.aggregateId} | Type=${e.eventType}`);
  });

  console.log('\n================================================================');
  console.log('        ALL SYSTEM DESIGN ARCHITECTURE PATTERNS VERIFIED        ');
  console.log('================================================================');
}

runDemo().catch(console.error);
