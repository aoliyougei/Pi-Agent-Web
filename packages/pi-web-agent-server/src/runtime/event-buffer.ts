import type { AgentStreamEvent } from "@aoliyougei/pi-agent-contract";

export interface EventReplay {
  resyncRequired: boolean;
  events: AgentStreamEvent[];
}

export class EventBuffer {
  private readonly events: AgentStreamEvent[] = [];
  private nextId = 1;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Invalid event buffer capacity");
  }

  append(payload: unknown): AgentStreamEvent {
    const event = { id: String(this.nextId++), data: JSON.stringify(payload) };
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.shift();
    return event;
  }

  replayAfter(cursor: string | undefined): EventReplay {
    if (cursor === undefined) return { resyncRequired: false, events: [] };
    if (!/^\d+$/.test(cursor)) return { resyncRequired: true, events: [] };
    const numeric = Number(cursor);
    if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric >= this.nextId) {
      return { resyncRequired: true, events: [] };
    }
    if (this.events.length && numeric < Number(this.events[0].id) - 1) {
      return { resyncRequired: true, events: [] };
    }
    return {
      resyncRequired: false,
      events: this.events.filter((event) => Number(event.id) > numeric),
    };
  }
}
