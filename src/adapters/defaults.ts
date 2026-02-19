import type {
  PersistenceAdapter, ContextProvider, MemoryProvider,
  CodebaseProvider, PersonaProvider, LifecycleHooks,
  ArtifactRequest, CreateRunParams, ActivityParams,
  Message, MemoryResult, PersonaConfig,
} from '../types.js';
import { randomUUID } from 'crypto';

export class InMemoryPersistence implements PersistenceAdapter {
  private runs = new Map<string, Record<string, unknown>>();
  private artifacts = new Map<string, ArtifactRequest>();
  private threads = new Map<string, Message[]>();
  private activities: ActivityParams[] = [];
  private insertionOrder: string[] = [];

  constructor(private maxRuns = 100) {}

  get runCount(): number { return this.runs.size; }

  async createRun(params: CreateRunParams): Promise<string> {
    const id = randomUUID();
    this.runs.set(id, { ...params, id, status: 'running', createdAt: Date.now() });
    this.insertionOrder.push(id);

    while (this.runs.size > this.maxRuns) {
      const oldest = this.insertionOrder.shift()!;
      this.runs.delete(oldest);
    }

    return id;
  }

  async updateRun(runId: string, updates: Record<string, unknown>): Promise<void> {
    const run = this.runs.get(runId);
    if (run) Object.assign(run, updates);
  }

  async createArtifact(params: ArtifactRequest): Promise<string> {
    const id = randomUUID();
    this.artifacts.set(id, params);
    return id;
  }

  async saveMessage(threadId: string, role: string, content: string): Promise<void> {
    const thread = this.threads.get(threadId) ?? [];
    thread.push({ role: role as Message['role'], content });
    this.threads.set(threadId, thread);
  }

  async loadThreadHistory(threadId: string): Promise<Message[]> {
    return this.threads.get(threadId) ?? [];
  }

  async logActivity(params: ActivityParams): Promise<void> {
    this.activities.push(params);
  }
}

export class NoopContextProvider implements ContextProvider {
  async getContext(_entityType: string, _entityId: string): Promise<string> { return ''; }
}

export class NoopMemoryProvider implements MemoryProvider {
  async search(_query: string, _k?: number): Promise<MemoryResult[]> { return []; }
  async store(_text: string, _metadata?: Record<string, unknown>): Promise<void> {}
}

export class NoopCodebaseProvider implements CodebaseProvider {
  async query(_repoId: string, _query: string, _tier: 'mini' | 'standard' | 'full'): Promise<string> { return ''; }
}

export class NoopPersonaProvider implements PersonaProvider {
  async getPersona(_role: string): Promise<PersonaConfig | null> { return null; }
}

export class NoopLifecycleHooks implements LifecycleHooks {}
