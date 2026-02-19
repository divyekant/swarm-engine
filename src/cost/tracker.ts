import type { CostSummary, TokenUsage } from '../types.js';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 300, output: 1500 },
  'claude-opus-4-20250514': { input: 1500, output: 7500 },
  'claude-haiku-3-5-20241022': { input: 80, output: 400 },
  'gpt-4o': { input: 250, output: 1000 },
  'gpt-4o-mini': { input: 15, output: 60 },
  'gpt-4.1': { input: 200, output: 800 },
  'gpt-4.1-mini': { input: 40, output: 160 },
  'gpt-4.1-nano': { input: 10, output: 40 },
  'gemini-2.0-flash': { input: 10, output: 40 },
  'gemini-2.5-pro': { input: 125, output: 1000 },
};

function getDefaultPricing(): { input: number; output: number } {
  return { input: 300, output: 1500 };
}

function emptyCost(): CostSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 };
}

export class CostTracker {
  private agentCosts = new Map<string, CostSummary>();
  private nodeCosts = new Map<string, CostSummary>();
  private totalCost: CostSummary = emptyCost();

  constructor(
    public readonly swarmBudget: number | null = null,
    public readonly perAgentBudget: number | null = null,
  ) {}

  recordUsage(agentId: string, nodeId: string, usage: TokenUsage): void {
    const cost = this.calculateCost(usage.model, usage.inputTokens, usage.outputTokens);

    this.totalCost.inputTokens += usage.inputTokens;
    this.totalCost.outputTokens += usage.outputTokens;
    this.totalCost.totalTokens += usage.inputTokens + usage.outputTokens;
    this.totalCost.costCents += cost;
    this.totalCost.calls++;

    const agentEntry = this.agentCosts.get(agentId) ?? emptyCost();
    agentEntry.inputTokens += usage.inputTokens;
    agentEntry.outputTokens += usage.outputTokens;
    agentEntry.totalTokens += usage.inputTokens + usage.outputTokens;
    agentEntry.costCents += cost;
    agentEntry.calls++;
    this.agentCosts.set(agentId, agentEntry);

    const nodeEntry = this.nodeCosts.get(nodeId) ?? emptyCost();
    nodeEntry.inputTokens += usage.inputTokens;
    nodeEntry.outputTokens += usage.outputTokens;
    nodeEntry.totalTokens += usage.inputTokens + usage.outputTokens;
    nodeEntry.costCents += cost;
    nodeEntry.calls++;
    this.nodeCosts.set(nodeId, nodeEntry);
  }

  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    let pricing = MODEL_PRICING[model];
    if (!pricing) {
      for (const [key, value] of Object.entries(MODEL_PRICING)) {
        if (model.startsWith(key)) {
          pricing = value;
          break;
        }
      }
    }
    if (!pricing) pricing = getDefaultPricing();

    const inputCost = Math.ceil((inputTokens * pricing.input) / 1_000_000);
    const outputCost = Math.ceil((outputTokens * pricing.output) / 1_000_000);
    return inputCost + outputCost;
  }

  getSwarmTotal(): CostSummary {
    return { ...this.totalCost };
  }

  getPerAgent(): Map<string, CostSummary> {
    return new Map(this.agentCosts);
  }

  getPerNode(): Map<string, CostSummary> {
    return new Map(this.nodeCosts);
  }

  checkBudget(): { ok: boolean; remaining: number; used: number } {
    if (this.swarmBudget === null) {
      return { ok: true, remaining: Infinity, used: this.totalCost.costCents };
    }
    return {
      ok: this.totalCost.costCents <= this.swarmBudget,
      remaining: Math.max(0, this.swarmBudget - this.totalCost.costCents),
      used: this.totalCost.costCents,
    };
  }

  checkAgentBudget(agentId: string): { ok: boolean; remaining: number; used: number } {
    if (this.perAgentBudget === null) {
      return { ok: true, remaining: Infinity, used: 0 };
    }
    const used = this.agentCosts.get(agentId)?.costCents ?? 0;
    return {
      ok: used <= this.perAgentBudget,
      remaining: Math.max(0, this.perAgentBudget - used),
      used,
    };
  }
}
