import { describe, it, expect } from 'vitest';
import { classifyError, SwarmError } from '../../src/errors/classification.js';

describe('classifyError', () => {
  it('classifies rate limit errors', () => {
    expect(classifyError(new Error('429 Too Many Requests'))).toBe('rate_limit');
  });

  it('classifies auth errors', () => {
    expect(classifyError(new Error('401 Unauthorized'))).toBe('auth_error');
  });

  it('classifies timeout errors', () => {
    const err = new Error('Request timed out');
    err.name = 'AbortError';
    expect(classifyError(err)).toBe('timeout');
  });

  it('classifies network errors', () => {
    const err = new Error('fetch failed');
    err.name = 'TypeError';
    expect(classifyError(err)).toBe('network_error');
  });

  it('classifies content filter errors', () => {
    expect(classifyError(new Error('content_policy_violation'))).toBe('content_filter');
  });

  it('returns unknown for unrecognized errors', () => {
    expect(classifyError(new Error('something weird'))).toBe('unknown');
  });

  it('handles non-Error values', () => {
    expect(classifyError('string error')).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
  });
});

describe('SwarmError', () => {
  it('carries error type and original error', () => {
    const original = new Error('429');
    const swarmErr = new SwarmError('Rate limited', 'rate_limit', original);
    expect(swarmErr.errorType).toBe('rate_limit');
    expect(swarmErr.cause).toBe(original);
    expect(swarmErr.message).toBe('Rate limited');
    expect(swarmErr.name).toBe('SwarmError');
  });
});
