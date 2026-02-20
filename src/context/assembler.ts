import type {
  Message,
  ContextProvider,
  MemoryProvider,
  CodebaseProvider,
  PersonaProvider,
} from '../types.js';
import type { SwarmMemory } from '../memory/index.js';
import { TokenBudget } from './budget.js';

interface UpstreamOutput {
  nodeId: string;
  agentRole: string;
  output: string;
}

export interface AssembleParams {
  systemPrompt: string;
  task: string;
  contextWindow: number;
  upstreamOutputs?: UpstreamOutput[];
  swarmMemory?: SwarmMemory;
  agentId?: string;
  threadHistory?: Message[];
  entityType?: string;
  entityId?: string;
}

interface AssemblerDeps {
  context: ContextProvider;
  memory: MemoryProvider;
  codebase: CodebaseProvider;
  persona: PersonaProvider;
}

/**
 * ContextAssembler builds the message array for an agent call.
 * It gathers context from all adapter sources and fits them within
 * the token budget using priority-based truncation.
 *
 * Priority order (1=highest, never truncated):
 *   persona(1) -> systemPrompt(1) -> task(1) -> upstream outputs(2)
 *   -> inbox/channels(3) -> scratchpad(3) -> entity context(4)
 *   -> memory search(5) -> codebase(6)
 */
export class ContextAssembler {
  private deps: AssemblerDeps;

  constructor(deps: AssemblerDeps) {
    this.deps = deps;
  }

  async assemble(params: AssembleParams): Promise<Message[]> {
    const {
      systemPrompt,
      task,
      contextWindow,
      upstreamOutputs,
      swarmMemory,
      agentId,
      threadHistory,
      entityType,
      entityId,
    } = params;

    // Reserve ~25% of context window for the response and thread history overhead
    const systemBudgetTokens = Math.floor(contextWindow * 0.75);
    const budget = new TokenBudget(systemBudgetTokens);

    // --- Priority 1: Persona ---
    const persona = await this.deps.persona.getPersona(agentId ?? 'default');
    if (persona) {
      if (persona.fullPrompt) {
        // Full PersonaSmith Markdown — inject as-is for maximum fidelity
        budget.add('persona', persona.fullPrompt, 1);
      } else {
        // Slim metadata — build structured block from fields
        const personaBlock = [
          `## Persona: ${persona.name}`,
          `Role: ${persona.role}`,
          `Traits: ${persona.traits.join(', ')}`,
          `Constraints: ${persona.constraints.join(', ')}`,
          persona.communicationStyle ? `Communication Style: ${persona.communicationStyle}` : '',
          persona.expertise?.length ? `Expertise: ${persona.expertise.join(', ')}` : '',
        ].filter(Boolean).join('\n');
        budget.add('persona', personaBlock, 1);
      }
    }

    // --- Priority 1: System prompt ---
    budget.add('system', systemPrompt, 1);

    // --- Priority 1: Task ---
    budget.add('task', `## Task\n${task}`, 1);

    // --- Priority 2: Upstream outputs ---
    if (upstreamOutputs?.length) {
      const upstreamBlock = upstreamOutputs
        .map(u => `### Output from ${u.agentRole} (${u.nodeId})\n${u.output}`)
        .join('\n\n');
      budget.add('upstream', `## Upstream Outputs\n${upstreamBlock}`, 2);
    }

    // --- Priority 3: Inbox / channels ---
    if (swarmMemory && agentId) {
      const inbox = swarmMemory.channels.getInbox(agentId);
      if (inbox.length > 0) {
        const inboxBlock = inbox
          .map(m => `[${m.from}]: ${m.content}`)
          .join('\n');
        budget.add('inbox', `## Messages\n${inboxBlock}`, 3);
      }
    }

    // --- Priority 3: Scratchpad ---
    if (swarmMemory) {
      const scratchpadContent = swarmMemory.scratchpad.toContext();
      if (scratchpadContent) {
        budget.add('scratchpad', `## Shared State\n${scratchpadContent}`, 3);
      }
    }

    // --- Priority 4: Entity context ---
    if (entityType && entityId) {
      const entityContext = await this.deps.context.getContext(entityType, entityId);
      if (entityContext) {
        budget.add('entity', `## Entity Context\n${entityContext}`, 4);
      }
    }

    // --- Priority 5: Memory search ---
    const memories = await this.deps.memory.search(task, 5);
    if (memories.length > 0) {
      const memoryBlock = memories
        .map(m => `- ${m.text}`)
        .join('\n');
      budget.add('memory', `## Relevant Memory\n${memoryBlock}`, 5);
    }

    // --- Priority 6: Codebase ---
    if (entityId) {
      const codebaseContext = await this.deps.codebase.query(entityId, task, 'mini');
      if (codebaseContext) {
        budget.add('codebase', `## Codebase\n${codebaseContext}`, 6);
      }
    }

    // Build system message content
    const systemContent = budget.build();

    const messages: Message[] = [];

    // System message
    messages.push({ role: 'system', content: systemContent });

    // Thread history (if any)
    if (threadHistory?.length) {
      messages.push(...threadHistory);
    }

    // User message with the task
    messages.push({ role: 'user', content: task });

    return messages;
  }
}
