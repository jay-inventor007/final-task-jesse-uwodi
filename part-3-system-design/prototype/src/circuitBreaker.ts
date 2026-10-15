/**
 * Payday Prototype — Circuit Breaker Pattern
 * Protects external bank rails from cascading failure.
 * Automatically sheds load when bank error rate exceeds failure threshold.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number; // e.g. 3 consecutive failures
  recoveryTimeoutMs: number; // e.g. 5000ms cooldown before HALF_OPEN probe
}

export class CircuitBreaker {
  public state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    public readonly name: string,
    private readonly config: CircuitBreakerConfig = { failureThreshold: 3, recoveryTimeoutMs: 3000 }
  ) {}

  async execute<T>(action: () => Promise<T>): Promise<T> {
    const now = Date.now();

    if (this.state === 'OPEN') {
      if (now - this.lastFailureTime > this.config.recoveryTimeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(`CircuitBreaker[${this.name}] is OPEN! Request rejected to prevent cascading failure.`);
      }
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
  }
}
