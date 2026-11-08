#!/usr/bin/env node
// Claude Code status line wrapper for the Herdr agent-usage mod.
// Saves the plan's rate_limits (5-hour and weekly percent used) to
// ~/.config/herdr-app/data/agent-usage/claude-limits.json, then runs your previous status line
// (the command in ~/.claude/statusline-herdr.next, if that file exists) with the same input and
// prints its output unchanged. No network, no credentials.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const NEXT = path.join(os.homedir(), ".claude", "statusline-herdr.next");
const OUT = path.join(os.homedir(), ".config", "herdr-app", "data", "agent-usage", "claude-limits.json");

let input = "";
try { input = fs.readFileSync(0, "utf8"); } catch {}

try {
  const rl = JSON.parse(input)?.rate_limits;
  if (rl && (rl.five_hour || rl.seven_day)) {
    const pick = (w) => w && { used: Number(w.used_percentage), resetsAt: Number(w.resets_at) };
    const body = JSON.stringify({ at: Date.now(), five_hour: pick(rl.five_hour) ?? null, seven_day: pick(rl.seven_day) ?? null });
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT + ".tmp", body);
    fs.renameSync(OUT + ".tmp", OUT);
  }
} catch {}

let next = "";
try { next = fs.readFileSync(NEXT, "utf8").trim(); } catch {}
// cmd.exe doesn't expand ~, so do it here
if (next) next = next.replace(/(^|\s)~(?=[\\/])/g, (_, pre) => pre + os.homedir().split(path.sep).join("/"));
if (next) {
  const r = spawnSync(next, { input, encoding: "utf8", shell: true });
  process.stdout.write(r.stdout ?? "");
  process.exitCode = r.status ?? 0;
}
