# Part 3: System Design — Payday Global Contractor Payout Platform

**System selected:** Option 2, Payday (multi-currency contractor payout platform)  
**Design scale assumption:** 50 million payouts/day (a design-time estimate; the prototype runs in memory on one machine)

---

## Deliverables

| Document | Purpose |
|---|---|
| [`DESIGN.md`](./DESIGN.md) | The design document: requirements, estimates, API, data model, architecture diagram, deep dives, patterns, scaling, failure modes, trade-offs, cost. |
| [`prototype/`](./prototype) | In-memory TypeScript prototype of the critical path: ledger, saga, rail router, circuit breaker, outbox. 15 assertions. |

Still to do (required by the brief): a run of 1,000 payouts with a randomly failing fake bank proving the ledger balances, a k6 load test, a failure drill write-up, the recorded walkthrough, a live mock interview with notes, and `LEARNING-LOG.md`.

---

## Design Patterns

1. **Saga Pattern (Orchestration)**: Coordinates multi-step, multi-currency payout lifecycles across external banking rails without blocking distributed locks. Manages forward execution and automatic compensating reversal entries.
2. **Transactional Outbox Pattern**: Eliminates the dual-write problem between PostgreSQL and Apache Kafka by writing ledger postings and outbox events in the same atomic ACID transaction.
3. **Idempotent Consumer Pattern**: Dedupes payout requests via `Idempotency-Key` headers stored in Redis and backed by unique SQL database constraints to guarantee zero double disbursements.
4. **Circuit Breaker Pattern**: Protects external bank rails (`CLOSED` $\rightarrow$ `OPEN` $\rightarrow$ `HALF_OPEN`) by shedding outbound traffic when bank error rates exceed thresholds.
5. **Strategy Pattern**: Dynamically routes payouts across heterogeneous international banking rails (ACH/US, NIP/Nigeria, SEPA/EU, Faster Payments/UK).
6. **Double-Entry Bookkeeping Pattern**: Guarantees financial math conservation ($\sum \text{Debits} + \sum \text{Credits} = 0$) using integer minor units (cents/kobo) with zero floating-point drift.

---

## Running the Working Prototype & Test Suite

The prototype is located in [`prototype/`](./prototype).

### 1. Run the test suite
```powershell
cd prototype
npm install
npm test
```

**Test Output:**
```
======================================================
       RUNNING PAYDAY SYSTEM DESIGN TEST SUITE        
======================================================

Test Suite 1: Double-Entry Ledger Invariant
  ✅ PASS: Debit correctly applied to account A
  ✅ PASS: Credit correctly applied to account B
  ✅ PASS: Unbalanced journal entry threw Error (Sum != 0)

Test Suite 2: Distributed Saga Success Flow
  ✅ PASS: Saga reached SETTLED state
  ✅ PASS: Employer balance correctly debited ($1,250.00 remaining)
  ✅ PASS: Clearing account returned to 0 after settlement
  ✅ PASS: Bank settlement account credited with $750.00
  ✅ PASS: Transactional outbox recorded 2 events (HOLD, SETTLED)

Test Suite 3: Idempotent Deduplication
  ✅ PASS: Replayed request returned identical payout ID
  ✅ PASS: Employer was NOT debited a second time

Test Suite 4: Rail Failure & Saga Compensation
  ✅ PASS: Saga reached COMPENSATED_REFUNDED state
  ✅ PASS: Employer balance was restored (refunded)
  ✅ PASS: Clearing account returned to 0

Test Suite 5: Circuit Breaker Pattern
  ✅ PASS: Circuit Breaker tripped to OPEN after 3 failures
  ✅ PASS: Circuit Breaker shed load and rejected outbound transfer while OPEN

======================================================
Test Results: 15 Passed, 0 Failed
======================================================
```

### 2. Run the End-to-End Execution Scenario Demo
```powershell
cd prototype
npm run demo
```
*(Executes all 4 live scenarios demonstrating initial ledger setup, successful ACH transfer, idempotency replay, bank rejection triggering compensation reversal, circuit breaker trip, and transactional outbox event storage).*
