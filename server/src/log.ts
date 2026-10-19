// Minimal leveled logger (LOG_LEVEL=debug|info|warn|error).

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
const envLevel = process.env.LOG_LEVEL;
const min = LEVELS[(envLevel && envLevel in LEVELS ? envLevel : "info") as Level];

function out(level: Level, msg: string) {
  if (LEVELS[level] < min) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}\n`;
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line);
}

export const log = {
  debug: (m: string) => out("debug", m),
  info: (m: string) => out("info", m),
  warn: (m: string) => out("warn", m),
  error: (m: string) => out("error", m),
};
