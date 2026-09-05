/** Categorized logging with per-category levels.
 *
 * A game engine logs from a dozen subsystems at once. Without categories the
 * output is either useless noise or switched off entirely, which is how real
 * warnings get missed. Every message here carries a category and a level, and
 * levels are set per category, so a developer debugging navigation can turn
 * that category to `debug` without drowning in renderer chatter.
 *
 * Output goes through a sink rather than straight to `console`, so the editor
 * can show logs in a panel, a test can assert on them, and a shipped build can
 * forward warnings to error reporting.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface LogRecord {
  readonly category: string;
  readonly level: Exclude<LogLevel, "silent">;
  readonly message: string;
  /** Structured context. Prefer this over interpolating values into `message`,
   * so tooling can filter and group on the values. */
  readonly data?: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
}

export type LogSink = (record: LogRecord) => void;

/** Writes to `console`, mapping levels onto the matching console method. */
export function consoleSink(target: Partial<Console> = console): LogSink {
  return (record) => {
    const method = record.level === "debug" ? target.debug : record.level === "info" ? target.info : record.level === "warn" ? target.warn : target.error;
    const label = `[${record.category}]`;
    if (record.data) (method ?? target.log)?.call(target, label, record.message, record.data);
    else (method ?? target.log)?.call(target, label, record.message);
  };
}

/** Collects records in memory, for the editor console and for tests. */
export class MemorySink {
  readonly records: LogRecord[] = [];
  readonly #limit: number;

  constructor(limit = 1000) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("A memory sink limit must be a whole number of at least 1.");
    this.#limit = limit;
  }

  readonly write: LogSink = (record) => {
    this.records.push(record);
    // Bounded, so a long session cannot exhaust memory through logging alone.
    if (this.records.length > this.#limit) this.records.splice(0, this.records.length - this.#limit);
  };

  filter(options: { readonly category?: string; readonly level?: Exclude<LogLevel, "silent"> } = {}): readonly LogRecord[] {
    return this.records.filter(
      (record) =>
        (options.category === undefined || record.category === options.category) &&
        (options.level === undefined || LEVEL_ORDER[record.level] >= LEVEL_ORDER[options.level]),
    );
  }

  clear(): void {
    this.records.length = 0;
  }
}

export interface LoggerOptions {
  readonly sink?: LogSink;
  /** Level for categories with no explicit setting. */
  readonly defaultLevel?: LogLevel;
  readonly now?: () => number;
}

/** A logger for one category. Subsystems hold one of these. */
export interface CategoryLogger {
  readonly category: string;
  debug(message: string, data?: Readonly<Record<string, unknown>>): void;
  info(message: string, data?: Readonly<Record<string, unknown>>): void;
  warn(message: string, data?: Readonly<Record<string, unknown>>): void;
  error(message: string, data?: Readonly<Record<string, unknown>>): void;
}

/** The log router: owns per-category levels and the sink. */
export class Logger {
  readonly #levels = new Map<string, LogLevel>();
  readonly #now: () => number;
  #sink: LogSink;
  #defaultLevel: LogLevel;

  constructor(options: LoggerOptions = {}) {
    this.#sink = options.sink ?? consoleSink();
    this.#defaultLevel = options.defaultLevel ?? "info";
    this.#now = options.now ?? (() => Date.now());
  }

  setSink(sink: LogSink): void {
    this.#sink = sink;
  }

  setDefaultLevel(level: LogLevel): void {
    this.#defaultLevel = requireLevel(level);
  }

  setLevel(category: string, level: LogLevel): void {
    this.#levels.set(requireCategory(category), requireLevel(level));
  }

  levelOf(category: string): LogLevel {
    return this.#levels.get(category) ?? this.#defaultLevel;
  }

  /** Categories with an explicit level, for a settings UI. */
  get configuredCategories(): readonly { readonly category: string; readonly level: LogLevel }[] {
    return [...this.#levels.entries()].map(([category, level]) => ({ category, level })).sort((a, b) => a.category.localeCompare(b.category));
  }

  isEnabled(category: string, level: Exclude<LogLevel, "silent">): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.levelOf(category)];
  }

  log(category: string, level: Exclude<LogLevel, "silent">, message: string, data?: Readonly<Record<string, unknown>>): void {
    const name = requireCategory(category);
    if (!this.isEnabled(name, level)) return;
    this.#sink({ category: name, level, message, timestamp: this.#now(), ...(data ? { data } : {}) });
  }

  /** A bound logger for one subsystem. */
  category(category: string): CategoryLogger {
    const name = requireCategory(category);
    return {
      category: name,
      debug: (message, data) => this.log(name, "debug", message, data),
      info: (message, data) => this.log(name, "info", message, data),
      warn: (message, data) => this.log(name, "warn", message, data),
      error: (message, data) => this.log(name, "error", message, data),
    };
  }
}

/** Category names the engine's own subsystems log under. */
export const LOG_CATEGORIES = {
  render: "render",
  physics: "physics",
  audio: "audio",
  input: "input",
  network: "network",
  resources: "resources",
  scene: "scene",
  navigation: "navigation",
  animation: "animation",
  xr: "xr",
  scripting: "scripting",
  assets: "assets",
} as const;

function requireCategory(category: string): string {
  const trimmed = category.trim();
  if (!trimmed) throw new Error("A log category must not be empty.");
  return trimmed;
}

function requireLevel(level: LogLevel): LogLevel {
  if (!Object.hasOwn(LEVEL_ORDER, level)) {
    throw new Error(`Unknown log level "${level}". Levels are ${Object.keys(LEVEL_ORDER).join(", ")}.`);
  }
  return level;
}
