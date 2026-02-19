import type { SwarmEvent } from '../types.js';

export class SwarmEventEmitter implements AsyncIterable<SwarmEvent> {
  private buffer: SwarmEvent[] = [];
  private resolve: ((value: IteratorResult<SwarmEvent>) => void) | null = null;
  private done = false;
  private err: Error | null = null;

  emit(event: SwarmEvent): void {
    if (this.done) return;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: event, done: false });
    } else {
      this.buffer.push(event);
    }
  }

  close(): void {
    this.done = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: undefined as unknown as SwarmEvent, done: true });
    }
  }

  error(err: Error): void {
    this.err = err;
    this.done = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: undefined as unknown as SwarmEvent, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SwarmEvent> {
    return {
      next: (): Promise<IteratorResult<SwarmEvent>> => {
        if (this.err) {
          return Promise.reject(this.err);
        }
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as unknown as SwarmEvent, done: true });
        }
        return new Promise((resolve) => {
          this.resolve = resolve;
        });
      },
    };
  }
}
