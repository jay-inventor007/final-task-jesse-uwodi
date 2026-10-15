/**
 * Payday Prototype — Transactional Outbox Pattern
 * Solves the dual-write problem between database transactions and message brokers.
 * Events are written transactionally with business entities, then reliably published.
 */

export interface OutboxEvent {
  id: number;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: any;
  published: boolean;
  createdAt: Date;
}

export class TransactionalOutbox {
  private events: OutboxEvent[] = [];
  private nextId = 1;

  recordEvent(aggregateType: string, aggregateId: string, eventType: string, payload: any): OutboxEvent {
    const event: OutboxEvent = {
      id: this.nextId++,
      aggregateType,
      aggregateId,
      eventType,
      payload,
      published: false,
      createdAt: new Date()
    };
    this.events.push(event);
    return event;
  }

  getUnpublishedEvents(): OutboxEvent[] {
    return this.events.filter(e => !e.published);
  }

  markAsPublished(eventId: number): void {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.published = true;
    }
  }

  getAllEvents(): OutboxEvent[] {
    return [...this.events];
  }
}
