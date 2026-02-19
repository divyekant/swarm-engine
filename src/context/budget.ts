interface Segment {
  label: string;
  content: string;
  priority: number;
}

/**
 * TokenBudget manages context assembly within a token limit.
 * Segments are added with priorities (1 = highest, never truncated).
 * When the total exceeds the budget, lowest-priority segments are truncated first.
 * Token estimation: 1 token ≈ 4 characters (conservative).
 */
export class TokenBudget {
  private segments: Segment[] = [];
  private maxTokens: number;

  constructor(maxTokens: number) {
    this.maxTokens = maxTokens;
  }

  add(label: string, content: string, priority: number): void {
    this.segments.push({ label, content, priority });
  }

  build(): string {
    // Sort segments by priority ascending (1 = highest priority, keep first)
    const sorted = [...this.segments].sort((a, b) => a.priority - b.priority);

    // Calculate total tokens
    let totalTokens = this.estimateTokens(
      sorted.map(s => s.content).join('\n\n'),
    );

    if (totalTokens <= this.maxTokens) {
      return sorted.map(s => s.content).join('\n\n');
    }

    // Need to truncate -- work from lowest priority (end of sorted array) backwards
    const result = sorted.map(s => ({ ...s }));

    // Truncate from lowest priority first
    for (let i = result.length - 1; i >= 0; i--) {
      if (totalTokens <= this.maxTokens) break;
      if (result[i].priority === 1) continue; // Never truncate priority 1

      const segmentTokens = this.estimateTokens(result[i].content);
      const excess = totalTokens - this.maxTokens;

      if (segmentTokens <= excess) {
        // Remove entire segment
        totalTokens -= segmentTokens;
        result[i].content = '';
      } else {
        // Partially truncate this segment
        const allowedTokens = segmentTokens - excess;
        const allowedChars = allowedTokens * 4;
        result[i].content = result[i].content.slice(0, allowedChars) + '...';
        totalTokens = this.maxTokens; // Approximation after truncation
      }
    }

    return result
      .filter(s => s.content.length > 0)
      .map(s => s.content)
      .join('\n\n');
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
