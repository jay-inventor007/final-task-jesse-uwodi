/**
 * Payday Prototype — Banking Rail Strategy Pattern
 * Dynamically routes payouts across heterogeneous international rails:
 * - NIP (Nigeria / NGN)
 * - ACH (United States / USD)
 * - SEPA (Eurozone / EUR)
 * - Faster Payments (United Kingdom / GBP)
 */

import { CircuitBreaker } from './circuitBreaker';

export interface PayoutDestination {
  beneficiaryName: string;
  accountNumber: string;
  routingCode: string;
  currency: string;
  country: string;
}

export interface RailExecutionResult {
  success: boolean;
  bankReference?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface BankingRailStrategy {
  readonly railCode: string;
  supports(currency: string, country: string): boolean;
  executeTransfer(payoutId: string, amountMinorUnits: number, dest: PayoutDestination): Promise<RailExecutionResult>;
}

export class AchRailStrategy implements BankingRailStrategy {
  readonly railCode = 'ACH_US';
  public circuitBreaker = new CircuitBreaker('ACH_US');
  public simulateFailure = false;

  supports(currency: string, country: string): boolean {
    return currency === 'USD' && country === 'US';
  }

  async executeTransfer(payoutId: string, amountMinorUnits: number, dest: PayoutDestination): Promise<RailExecutionResult> {
    return this.circuitBreaker.execute(async () => {
      if (this.simulateFailure) {
        throw new Error('BANK_RAIL_REJECTED: Account routing code 021000021 blocked by FedACH');
      }
      return {
        success: true,
        bankReference: `ACH_FED_${Date.now()}_${payoutId.substring(0, 8)}`
      };
    });
  }
}

export class NipRailStrategy implements BankingRailStrategy {
  readonly railCode = 'NIP_NG';
  public circuitBreaker = new CircuitBreaker('NIP_NG');
  public simulateFailure = false;

  supports(currency: string, country: string): boolean {
    return currency === 'NGN' && country === 'NG';
  }

  async executeTransfer(payoutId: string, amountMinorUnits: number, dest: PayoutDestination): Promise<RailExecutionResult> {
    return this.circuitBreaker.execute(async () => {
      if (this.simulateFailure) {
        throw new Error('BANK_RAIL_REJECTED: NIBSS session timeout or invalid destination NUBAN');
      }
      return {
        success: true,
        bankReference: `NIBSS_TR_${Date.now()}_${payoutId.substring(0, 8)}`
      };
    });
  }
}

export class SepaRailStrategy implements BankingRailStrategy {
  readonly railCode = 'SEPA_EU';
  public circuitBreaker = new CircuitBreaker('SEPA_EU');
  public simulateFailure = false;

  supports(currency: string, country: string): boolean {
    return currency === 'EUR';
  }

  async executeTransfer(payoutId: string, amountMinorUnits: number, dest: PayoutDestination): Promise<RailExecutionResult> {
    return this.circuitBreaker.execute(async () => {
      if (this.simulateFailure) {
        throw new Error('BANK_RAIL_REJECTED: IBAN check digits failed validation at European Central Bank');
      }
      return {
        success: true,
        bankReference: `SEPA_INST_${Date.now()}_${payoutId.substring(0, 8)}`
      };
    });
  }
}

export class RailRouter {
  private strategies: BankingRailStrategy[] = [];

  constructor() {
    this.strategies = [
      new AchRailStrategy(),
      new NipRailStrategy(),
      new SepaRailStrategy()
    ];
  }

  getStrategy(currency: string, country: string): BankingRailStrategy {
    const strategy = this.strategies.find(s => s.supports(currency, country));
    if (!strategy) {
      throw new Error(`No available banking rail strategy for currency ${currency} and country ${country}`);
    }
    return strategy;
  }

  getStrategyByCode<T extends BankingRailStrategy>(code: string): T {
    const s = this.strategies.find(strat => strat.railCode === code);
    if (!s) throw new Error(`Strategy ${code} not found`);
    return s as T;
  }
}
