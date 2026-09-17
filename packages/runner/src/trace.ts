import type { Store, TraceEvent, TraceEventInput } from "@populace/core";

/** Ordered, persisted trace of one wake. Every model call and tool call goes through here. */
export class TraceWriter {
  private seq = 0;
  private readonly buffer: TraceEvent[] = [];

  constructor(
    private readonly store: Store,
    readonly wakeId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async write(input: TraceEventInput): Promise<TraceEvent> {
    const event: TraceEvent = { ...input, seq: this.seq++, at: this.now().toISOString(), wakeId: this.wakeId };
    this.buffer.push(event);
    await this.store.appendTraceEvent(event);
    return event;
  }

  get events(): readonly TraceEvent[] {
    return this.buffer;
  }

  get nextSeq(): number {
    return this.seq;
  }
}
