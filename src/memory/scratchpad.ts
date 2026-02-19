import type { ScratchpadEntry } from '../types.js';

interface ScratchpadLimits {
  maxKeyBytes: number;
  maxTotalBytes: number;
}

const DEFAULT_LIMITS: ScratchpadLimits = {
  maxKeyBytes: 10_240,
  maxTotalBytes: 102_400,
};

export class Scratchpad {
  private store = new Map<string, unknown>();
  private lists = new Map<string, unknown[]>();
  private history = new Map<string, ScratchpadEntry[]>();
  private currentBytes = 0;
  private limits: ScratchpadLimits;

  constructor(limits?: Partial<ScratchpadLimits>) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  set(key: string, value: unknown, agentId: string): void {
    const valueBytes = this.estimateBytes(value);
    const oldBytes = this.estimateBytes(this.store.get(key));

    if (valueBytes > this.limits.maxKeyBytes) {
      throw new Error(`Scratchpad key "${key}" exceeds max size (${valueBytes} > ${this.limits.maxKeyBytes} bytes)`);
    }
    if (this.currentBytes - oldBytes + valueBytes > this.limits.maxTotalBytes) {
      throw new Error(`Scratchpad total size would exceed limit (${this.limits.maxTotalBytes} bytes)`);
    }

    this.currentBytes = this.currentBytes - oldBytes + valueBytes;
    this.store.set(key, value);

    const entries = this.history.get(key) ?? [];
    entries.push({ key, value, writtenBy: agentId, timestamp: Date.now(), operation: 'set' });
    this.history.set(key, entries);
  }

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  append(key: string, value: unknown, agentId: string): void {
    const list = this.lists.get(key) ?? [];
    const valueBytes = this.estimateBytes(value);

    if (this.currentBytes + valueBytes > this.limits.maxTotalBytes) {
      throw new Error(`Scratchpad total size would exceed limit (${this.limits.maxTotalBytes} bytes)`);
    }

    list.push(value);
    this.currentBytes += valueBytes;
    this.lists.set(key, list);

    const entries = this.history.get(key) ?? [];
    entries.push({ key, value, writtenBy: agentId, timestamp: Date.now(), operation: 'append' });
    this.history.set(key, entries);
  }

  getList<T>(key: string): T[] {
    return (this.lists.get(key) ?? []) as T[];
  }

  keys(): string[] {
    const allKeys = new Set([...this.store.keys(), ...this.lists.keys()]);
    return [...allKeys];
  }

  getHistory(key: string): ScratchpadEntry[] {
    return this.history.get(key) ?? [];
  }

  toContext(): string {
    const lines: string[] = [];
    for (const [key, value] of this.store) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
    for (const [key, list] of this.lists) {
      lines.push(`${key}: ${JSON.stringify(list)}`);
    }
    return lines.join('\n');
  }

  private estimateBytes(value: unknown): number {
    if (value === undefined || value === null) return 0;
    return Buffer.byteLength(JSON.stringify(value), 'utf-8');
  }
}
