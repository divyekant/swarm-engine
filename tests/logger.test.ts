import { describe, it, expect, vi } from 'vitest';
import { Logger } from '../src/logger.js';
import type { LogEntry, LoggingConfig } from '../src/types.js';

describe('Logger', () => {
  describe('level filtering', () => {
    it('logs messages at or above configured level', () => {
      const onLog = vi.fn();
      const logger = new Logger({ level: 'warn', onLog });

      logger.debug('skip');
      logger.info('skip');
      logger.warn('show');
      logger.error('show');

      expect(onLog).toHaveBeenCalledTimes(2);
      expect(onLog.mock.calls[0][0].level).toBe('warn');
      expect(onLog.mock.calls[1][0].level).toBe('error');
    });

    it('logs all levels when level is debug', () => {
      const onLog = vi.fn();
      const logger = new Logger({ level: 'debug', onLog });

      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');

      expect(onLog).toHaveBeenCalledTimes(4);
    });
  });

  describe('noop logger', () => {
    it('does nothing when created without config', () => {
      const logger = new Logger();
      // Should not throw
      logger.debug('no-op');
      logger.info('no-op');
      logger.warn('no-op');
      logger.error('no-op');
    });

    it('does not write to stderr when config is undefined', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const logger = new Logger();

      logger.error('should not appear');

      expect(stderrSpy).not.toHaveBeenCalled();
      stderrSpy.mockRestore();
    });
  });

  describe('child logger', () => {
    it('merges parent context with child context', () => {
      const onLog = vi.fn();
      const parent = new Logger({ level: 'info', onLog });
      const child = parent.child({ dagId: 'dag-1' });
      const grandchild = child.child({ nodeId: 'a' });

      grandchild.info('test');

      expect(onLog).toHaveBeenCalledTimes(1);
      const entry = onLog.mock.calls[0][0] as LogEntry;
      expect(entry.context).toEqual({ dagId: 'dag-1', nodeId: 'a' });
    });

    it('inherits level filtering from parent', () => {
      const onLog = vi.fn();
      const parent = new Logger({ level: 'warn', onLog });
      const child = parent.child({ component: 'test' });

      child.debug('filtered');
      child.info('filtered');
      child.warn('shown');

      expect(onLog).toHaveBeenCalledTimes(1);
      expect(onLog.mock.calls[0][0].level).toBe('warn');
    });
  });

  describe('LogEntry structure', () => {
    it('includes timestamp and message', () => {
      const onLog = vi.fn();
      const logger = new Logger({ level: 'info', onLog });

      logger.info('hello', { key: 'val' });

      const entry = onLog.mock.calls[0][0] as LogEntry;
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('hello');
      expect(entry.timestamp).toBeGreaterThan(0);
      expect(entry.context).toEqual({ key: 'val' });
    });

    it('omits context when none is provided', () => {
      const onLog = vi.fn();
      const logger = new Logger({ level: 'info', onLog });

      logger.info('bare message');

      const entry = onLog.mock.calls[0][0] as LogEntry;
      expect(entry.context).toBeUndefined();
    });
  });

  describe('stderr output', () => {
    it('writes human-readable format by default', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const logger = new Logger({ level: 'info' });

      logger.info('test message', { nodeId: 'a' });

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('[INFO]');
      expect(output).toContain('test message');
      expect(output).toContain('nodeId');
      stderrSpy.mockRestore();
    });

    it('writes JSON lines when structured is true', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const logger = new Logger({ level: 'info', structured: true });

      logger.info('json test', { dagId: 'x' });

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('json test');
      expect(parsed.context.dagId).toBe('x');
      stderrSpy.mockRestore();
    });
  });
});
