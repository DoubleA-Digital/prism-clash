#!/usr/bin/env node
// Runs the game server (port 8787, auto-restart) and the Vite client (port 5173) together.
//   npm run dev   → open http://localhost:5173
import { spawn } from "node:child_process";

const run = (name, cmd, args, cwd) => {
  const p = spawn(cmd, args, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  const tag = (d) => process.stdout.write(d.toString().split("\n").filter(Boolean).map((l) => `[${name}] ${l}\n`).join(""));
  p.stdout.on("data", tag);
  p.stderr.on("data", tag);
  return p;
};

const procs = [run("server", "pnpm", ["-C", "server", "dev"], "."), run("client", "pnpm", ["-C", "client", "dev", "--", "--port", "5173", "--strictPort"], ".")];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
