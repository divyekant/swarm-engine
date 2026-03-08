import { describe, it, expect } from 'vitest';
import { evidenceGuard } from '../../src/guards/evidence.js';

describe('evidence guard', () => {
  it('warns when claims present but no evidence', () => {
    const result = evidenceGuard('All tests pass and everything works correctly.');
    expect(result.triggered).toBe(true);
    expect(result.claims).toContain('all tests pass');
  });

  it('passes when claims have code block evidence', () => {
    const result = evidenceGuard(
      'All tests pass.\n\n```\n$ npm test\n✓ 42 tests passed\n```',
    );
    expect(result.triggered).toBe(false);
  });

  it('passes when no claims made', () => {
    const result = evidenceGuard('Here is the implementation for the auth module.');
    expect(result.triggered).toBe(false);
  });

  it('detects multiple claim patterns', () => {
    const result = evidenceGuard('No issues found. Verified successfully.');
    expect(result.triggered).toBe(true);
    expect(result.claims.length).toBeGreaterThanOrEqual(2);
  });

  it('recognizes file paths as evidence', () => {
    const result = evidenceGuard(
      'All tests pass. See results in src/tests/output.log and /tmp/results.json',
    );
    expect(result.triggered).toBe(false);
  });

  it('recognizes command outputs as evidence', () => {
    const result = evidenceGuard(
      'Verified successfully.\n\n$ vitest run\nTests: 5 passed',
    );
    expect(result.triggered).toBe(false);
  });
});
