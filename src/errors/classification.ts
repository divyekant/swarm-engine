import type { AgentErrorType } from '../types.js';

export class SwarmError extends Error {
  constructor(
    message: string,
    public readonly errorType: AgentErrorType,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'SwarmError';
  }
}

export function classifyError(err: unknown): AgentErrorType {
  if (!(err instanceof Error)) return 'unknown';

  const msg = err.message.toLowerCase();
  const name = err.name;

  if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('rate limit')) {
    return 'rate_limit';
  }

  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('invalid api key') || msg.includes('authentication')) {
    return 'auth_error';
  }

  if (name === 'AbortError' || msg.includes('timed out') || msg.includes('timeout') || msg.includes('deadline')) {
    return 'timeout';
  }

  if (msg.includes('content_policy') || msg.includes('content_filter') || msg.includes('safety') || msg.includes('moderation')) {
    return 'content_filter';
  }

  if (name === 'TypeError' || msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network')) {
    return 'network_error';
  }

  return 'unknown';
}
