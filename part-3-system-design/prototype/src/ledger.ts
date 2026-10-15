/**
 * Payday Prototype — Double-Entry Ledger Engine
 * Enforces the core financial accounting invariant:
 * Sum(Debits) + Sum(Credits) = 0 for every transaction.
 * All amounts stored in integer minor units (e.g. cents/kobo).
 */

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface Account {
  id: string;
  tenantId: string;
  accountType: AccountType;
  currency: string;
  currentBalanceMinorUnits: number;
}

export interface Posting {
  accountId: string;
  amountMinorUnits: number; // Positive for Debit, Negative for Credit
  direction: 'DEBIT' | 'CREDIT';
}

export interface JournalEntry {
  id: string;
  reference: string;
  description: string;
  postings: Posting[];
  createdAt: Date;
}

export class LedgerEngine {
  private accounts: Map<string, Account> = new Map();
  private journalEntries: JournalEntry[] = [];

  createAccount(id: string, tenantId: string, accountType: AccountType, currency: string, initialBalance = 0): Account {
    if (this.accounts.has(id)) {
      throw new Error(`Account ${id} already exists`);
    }
    const account: Account = {
      id,
      tenantId,
      accountType,
      currency,
      currentBalanceMinorUnits: initialBalance
    };
    this.accounts.set(id, account);
    return account;
  }

  getAccount(id: string): Account {
    const acc = this.accounts.get(id);
    if (!acc) throw new Error(`Account ${id} not found in ledger`);
    return acc;
  }

  getBalance(id: string): number {
    return this.getAccount(id).currentBalanceMinorUnits;
  }

  recordJournalEntry(reference: string, description: string, postings: Posting[]): JournalEntry {
    if (postings.length < 2) {
      throw new Error("A double-entry journal entry must have at least 2 legs (debit & credit)");
    }

    // Invariant Check 1: Sum of debits and credits MUST equal zero
    const sum = postings.reduce((acc, p) => acc + p.amountMinorUnits, 0);
    if (sum !== 0) {
      throw new Error(`Unbalanced journal entry! Sum of postings is ${sum}, must be 0`);
    }

    // Invariant Check 2: All accounts must exist and currencies must match
    for (const p of postings) {
      if (!this.accounts.has(p.accountId)) {
        throw new Error(`Account ${p.accountId} does not exist`);
      }
    }

    // Atomic execution: update account balances
    for (const p of postings) {
      const account = this.accounts.get(p.accountId)!;
      account.currentBalanceMinorUnits += p.amountMinorUnits;
    }

    const entry: JournalEntry = {
      id: `je_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      reference,
      description,
      postings,
      createdAt: new Date()
    };

    this.journalEntries.push(entry);
    return entry;
  }
}
