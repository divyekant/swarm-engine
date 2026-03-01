import type { LogEntry, LoggingConfig } from './types.js';

const LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  private readonly config: LoggingConfig | undefined;
  private readonly threshold: number;
  private readonly structured: boolean;
  private readonly onLog?: (entry: LogEntry) => void;
  private readonly baseContext: Record<string, unknown>;
  private readonly enabled: boolean;

  constructor(config?: LoggingConfig, baseContext?: Record<string, unknown>) {
    this.config = config;
    this.enabled = !!config;
    this.threshold = config ? LEVELS[config.level] : 4;
    this.structured = config?.structured ?? false;
    this.onLog = config?.onLog;
    this.baseContext = baseContext ?? {};
  }

  child(context: Record<string, unknown>): Logger {
    return new Logger(this.config, { ...this.baseContext, ...context });
  }

  debug(message: string, context?: Record<string, unknown>): void { this.log('debug', message, context); }
  info(message: string, context?: Record<string, unknown>): void { this.log('info', message, context); }
  warn(message: string, context?: Record<string, unknown>): void { this.log('warn', message, context); }
  error(message: string, context?: Record<string, unknown>): void { this.log('error', message, context); }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>): void {
    if (!this.enabled || LEVELS[level] < this.threshold) return;

    const mergedContext = (Object.keys(this.baseContext).length > 0 || context)
      ? { ...this.baseContext, ...context }
      : undefined;

    const entry: LogEntry = { level, message, timestamp: Date.now(), context: mergedContext };

    if (this.structured) {
      process.stderr.write(JSON.stringify(entry) + '\n');
    } else {
      const tag = `[${level.toUpperCase()}]`;
      const ctx = mergedContext ? ' ' + JSON.stringify(mergedContext) : '';
      process.stderr.write(`${tag} ${message}${ctx}\n`);
    }

    if (this.onLog) this.onLog(entry);
  }
}
