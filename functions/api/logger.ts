export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY_PATTERN =
  /^(authorization|token|bearer|secret|password|credential|cookie|api[_-]?key)$/i;
const REDACTED = "[REDACTED]";

export function sanitizeMetadata(value: unknown, seen = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadata(item, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = REDACTED;
    } else {
      sanitized[key] = sanitizeMetadata(val, seen);
    }
  }
  return sanitized;
}

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

export type LogSink = (entry: LogRecord, level: LogLevel) => void;

export interface LoggerOptions {
  minLevel?: LogLevel;
  sink?: LogSink;
}

export class Logger {
  private minSeverity: number;
  private sink: LogSink;

  constructor(options: LoggerOptions = {}) {
    this.minSeverity = LOG_LEVEL_SEVERITY[options.minLevel ?? "info"];
    this.sink =
      options.sink ??
      ((entry, level) => {
        const json = JSON.stringify(entry);
        console[level](json);
      });
  }

  private log(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
  ): LogRecord | null {
    if (LOG_LEVEL_SEVERITY[level] < this.minSeverity) {
      return null;
    }

    const entry: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (metadata && typeof metadata === "object") {
      const sanitized = sanitizeMetadata(metadata) as Record<string, unknown>;
      Object.assign(entry, sanitized);
    }

    this.sink(entry, level);
    return entry;
  }

  debug(message: string, metadata?: Record<string, unknown>): LogRecord | null {
    return this.log("debug", message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): LogRecord | null {
    return this.log("info", message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): LogRecord | null {
    return this.log("warn", message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): LogRecord | null {
    return this.log("error", message, metadata);
  }
}

export const logger = new Logger();
