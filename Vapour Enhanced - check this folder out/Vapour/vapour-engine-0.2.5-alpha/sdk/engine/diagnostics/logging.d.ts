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
export declare function consoleSink(target?: Partial<Console>): LogSink;
/** Collects records in memory, for the editor console and for tests. */
export declare class MemorySink {
    #private;
    readonly records: LogRecord[];
    constructor(limit?: number);
    readonly write: LogSink;
    filter(options?: {
        readonly category?: string;
        readonly level?: Exclude<LogLevel, "silent">;
    }): readonly LogRecord[];
    clear(): void;
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
export declare class Logger {
    #private;
    constructor(options?: LoggerOptions);
    setSink(sink: LogSink): void;
    setDefaultLevel(level: LogLevel): void;
    setLevel(category: string, level: LogLevel): void;
    levelOf(category: string): LogLevel;
    /** Categories with an explicit level, for a settings UI. */
    get configuredCategories(): readonly {
        readonly category: string;
        readonly level: LogLevel;
    }[];
    isEnabled(category: string, level: Exclude<LogLevel, "silent">): boolean;
    log(category: string, level: Exclude<LogLevel, "silent">, message: string, data?: Readonly<Record<string, unknown>>): void;
    /** A bound logger for one subsystem. */
    category(category: string): CategoryLogger;
}
/** Category names the engine's own subsystems log under. */
export declare const LOG_CATEGORIES: {
    readonly render: "render";
    readonly physics: "physics";
    readonly audio: "audio";
    readonly input: "input";
    readonly network: "network";
    readonly resources: "resources";
    readonly scene: "scene";
    readonly navigation: "navigation";
    readonly animation: "animation";
    readonly xr: "xr";
    readonly scripting: "scripting";
    readonly assets: "assets";
};
//# sourceMappingURL=logging.d.ts.map