/**
 * Payday Automated Verification Suite
 * Tests:
 * 1. Double-Entry Ledger Invariant Check (balanced vs unbalanced entries)
 * 2. Full Successful Payout Saga Lifecycle
 * 3. Rail Failure & Automatic Compensating Transaction (Ledger Refund)
 * 4. Idempotent Deduplication (Zero Double Disbursement)
 * 5. Circuit Breaker Load Shedding
 */

import { LedgerEngine } from './ledger';
import { RailRouter, AchRailStrategy, NipRailStrategy } from './railRouter';
import { TransactionalOutbox } from './outbox';
import { SagaOrchestrator, PayoutRequest } from './sagaOrchestrator';

declare const process: any;

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('       RUNNING PAYDAY SYSTEM DESIGN TEST SUITE        ');
  console.log('======================================================\n');

  // TEST 1: Double-Entry Accounting Invariant
  console.log('Test Suite 1: Double-Entry Ledger Invariant');
  const ledger1 = new LedgerEngine();
  const accA = ledger1.createAccount('acc_a', 't1', 'LIABILITY', 'USD', 10000);
  const accB = ledger1.createAccount('acc_b', 't1', 'ASSET', 'USD', 0);

  // Balanced entry should succeed
  ledger1.recordJournalEntry('ref_1', 'Transfer 50 USD', [
    { accountId: accA.id, amountMinorUnits: -5000, direction: 'DEBIT' },
    { accountId: accB.id, amountMinorUnits: 5000, direction: 'CREDIT' }
  ]);
  assert(ledger1.getBalance(accA.id) === 5000, 'Debit correctly applied to account A');
  assert(ledger1.getBalance(accB.id) === 5000, 'Credit correctly applied to account B');

  // Unbalanced entry must be rejected
  let threwUnbalanced = false;
  try {
    ledger1.recordJournalEntry('ref_bad', 'Unbalanced attempt', [
      { accountId: accA.id, amountMinorUnits: -2000, direction: 'DEBIT' },
      { accountId: accB.id, amountMinorUnits: 1500, direction: 'CREDIT' }
    ]);
  } catch (e) {
    threwUnbalanced = true;
  }
  assert(threwUnbalanced, 'Unbalanced journal entry threw Error (Sum != 0)');

  // TEST 2: Successful Saga Payout
  console.log('\nTest Suite 2: Distributed Saga Success Flow');
  const ledger2 = new LedgerEngine();
  const emp2 = ledger2.createAccount('emp_usd', 't1', 'LIABILITY', 'USD', 200000); // $2,000.00
  const clr2 = ledger2.createAccount('clr_usd', 't1', 'ASSET', 'USD', 0);
  const stl2 = ledger2.createAccount('stl_usd', 't1', 'ASSET', 'USD', 0);
  const outbox2 = new TransactionalOutbox();
  const router2 = new RailRouter();
  const orch2 = new SagaOrchestrator(ledger2, router2, outbox2, clr2.id, stl2.id);

  const req2: PayoutRequest = {
    idempotencyKey: 'idemp_test_success_1',
    tenantId: 't1',
    sourceAccountId: emp2.id,
    amountMinorUnits: 75000, // $750.00
    currency: 'USD',
    destination: {
      beneficiaryName: 'Jesse Uwodi',
      accountNumber: '1122334455',
      routingCode: '021000021',
      currency: 'USD',
      country: 'US'
    }
  };

  const res2 = await orch2.processPayout(req2);
  assert(res2.state === 'SETTLED', 'Saga reached SETTLED state');
  assert(ledger2.getBalance(emp2.id) === 125000, 'Employer balance correctly debited ($1,250.00 remaining)');
  assert(ledger2.getBalance(clr2.id) === 0, 'Clearing account returned to 0 after settlement');
  assert(ledger2.getBalance(stl2.id) === 75000, 'Bank settlement account credited with $750.00');
  assert(outbox2.getUnpublishedEvents().length === 2, 'Transactional outbox recorded 2 events (HOLD, SETTLED)');

  // TEST 3: Idempotent Deduplication (Zero Double-Disbursement)
  console.log('\nTest Suite 3: Idempotent Deduplication');
  const res2Replay = await orch2.processPayout(req2);
  assert(res2Replay.payoutId === res2.payoutId, 'Replayed request returned identical payout ID');
  assert(ledger2.getBalance(emp2.id) === 125000, 'Employer was NOT debited a second time');

  // TEST 4: Rail Failure & Automatic Compensation
  console.log('\nTest Suite 4: Rail Failure & Saga Compensation');
  const achStrat = router2.getStrategyByCode<AchRailStrategy>('ACH_US');
  achStrat.simulateFailure = true;

  const reqFail: PayoutRequest = {
    idempotencyKey: 'idemp_test_fail_1',
    tenantId: 't1',
    sourceAccountId: emp2.id,
    amountMinorUnits: 25000, // $250.00
    currency: 'USD',
    destination: {
      beneficiaryName: 'Bad Contractor',
      accountNumber: '000000',
      routingCode: '021000021',
      currency: 'USD',
      country: 'US'
    }
  };

  const resFail = await orch2.processPayout(reqFail);
  assert(resFail.state === 'COMPENSATED_REFUNDED', 'Saga reached COMPENSATED_REFUNDED state');
  assert(ledger2.getBalance(emp2.id) === 125000, 'Employer balance was restored (refunded)');
  assert(ledger2.getBalance(clr2.id) === 0, 'Clearing account returned to 0');

  // TEST 5: Circuit Breaker Load Shedding
  console.log('\nTest Suite 5: Circuit Breaker Pattern');
  const nipStrat = router2.getStrategyByCode<NipRailStrategy>('NIP_NG');
  nipStrat.simulateFailure = true;

  // Trigger 3 failures to trip breaker
  for (let i = 1; i <= 3; i++) {
    try {
      await nipStrat.executeTransfer(`fail_${i}`, 1000, {
        beneficiaryName: 'Test',
        accountNumber: '000',
        routingCode: '000',
        currency: 'NGN',
        country: 'NG'
      });
    } catch (_) {}
  }

  assert(nipStrat.circuitBreaker.state === 'OPEN', 'Circuit Breaker tripped to OPEN after 3 failures');

  let cbProtected = false;
  try {
    await nipStrat.executeTransfer('fail_probe', 1000, {
      beneficiaryName: 'Test',
      accountNumber: '000',
      routingCode: '000',
      currency: 'NGN',
      country: 'NG'
    });
  } catch (err: any) {
    if (err.message.includes('CircuitBreaker[NIP_NG] is OPEN')) {
      cbProtected = true;
    }
  }
  assert(cbProtected, 'Circuit Breaker shed load and rejected outbound transfer while OPEN');

  console.log('\n======================================================');
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
