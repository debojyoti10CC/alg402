import chalk from "chalk";
import type { Logger } from "../core/types.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(minLevel: LogLevel = "info"): Logger {
  const shouldLog = (level: LogLevel) => LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
  const write = (level: LogLevel, color: (s: string) => string, msg: string, meta?: unknown) => {
    if (!shouldLog(level)) return;
    const prefix = color(`[${level}]`);
    if (meta !== undefined) {
      console.error(`${prefix} ${msg}`, meta);
    } else {
      console.error(`${prefix} ${msg}`);
    }
  };

  return {
    debug: (msg, meta) => write("debug", chalk.gray, msg, meta),
    info: (msg, meta) => write("info", chalk.cyan, msg, meta),
    warn: (msg, meta) => write("warn", chalk.yellow, msg, meta),
    error: (msg, meta) => write("error", chalk.red, msg, meta),
  };
}
