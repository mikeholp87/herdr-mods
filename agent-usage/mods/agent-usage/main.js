// The status bar with agent usage added: Codex 5h / 7d percent of limit, Claude Code tokens
// in the last 5 hours and today. Everything is read from local session logs; no network,
// no tokens. Codex: the newest rate_limits its sessions logged. Claude: usage.ps1.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, exec, home, appHome } from "herdr";
import * as fs from "fs/promises";

const REFRESH_MS = 120000;
// Each log line starts with its timestamp; the limits ride on the token_count events.
const LIMITS = /"timestamp":"([^"]+)"[^\n]*?"primary":\{"used_percent":([\d.]+),"window_minutes":(\d+),"resets_at":(\d+)\},"secondary":\{"used_percent":([\d.]+),"window_minutes":(\d+),"resets_at":(\d+)/g;

const newest = async (dir) => (await fs.readdir(dir)).filter((n) => /^\d+$/.test(n)).sort().reverse();

// File names are local time but events are UTC, so the newest name isn't always the newest
// event: read the latest few sessions and keep the event with the latest timestamp.
async function codexLimits() {
  const base = `${home()}/.codex/sessions`;
  if (!(await fs.exists(base))) return { error: "no sessions" };
  const files = [];
  for (const y of await newest(base)) for (const m of await newest(`${base}/${y}`)) for (const d of await newest(`${base}/${y}/${m}`)) {
    for (const f of (await fs.readdir(`${base}/${y}/${m}/${d}`)).filter((f) => f.endsWith(".jsonl")).sort().reverse()) files.push(`${base}/${y}/${m}/${d}/${f}`);
    if (files.length >= 8) break;
  }
  let best = null;
  for (const file of files.slice(0, 8)) {
    for (const x of (await fs.readFile(file, "utf8")).matchAll(LIMITS)) {
      const at = Date.parse(x[1]);
      if (!best || at > best.at) best = { at, x };
    }
  }
  if (!best) return { error: "no limits logged" };
  const x = best.x, now = Date.now() / 1000;
  const win = (label, used, reset) => ({ label, used: now >= Number(reset) ? 0 : Number(used), resetsAt: Number(reset) * 1000 });
  return { windows: [win("5h", x[2], x[4]), win("7d", x[5], x[7])], at: best.at };
}

// The plan's percent used, saved by ~/.claude/statusline-herdr.cjs from Claude Code's status line input.
async function claudeLimits() {
  const file = `${appHome()}/data/agent-usage/claude-limits.json`;
  if (!(await fs.exists(file))) return null;
  const d = JSON.parse(await fs.readFile(file, "utf8"));
  const now = Date.now() / 1000;
  const win = (label, w) => w && Number.isFinite(w.used) && { label, used: now >= w.resetsAt ? 0 : w.used, resetsAt: w.resetsAt * 1000 };
  const windows = [win("5h", d.five_hour), win("7d", d.seven_day)].filter(Boolean);
  return windows.length ? { windows, at: d.at } : null;
}

async function claudeTokens() {
  const lim = await claudeLimits().catch(() => null);
  const r = await exec("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", `${appHome()}/mods/agent-usage/usage.ps1`]);
  if (r.code !== 0) return { error: (r.stderr || "failed").trim().slice(0, 80), limits: lim };
  return { ...JSON.parse(r.stdout.trim()), limits: lim };
}

const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const left = (ms) => { const m = Math.max(0, Math.round((ms - Date.now()) / 60000)); return m >= 1440 ? `${Math.round(m / 1440)}d` : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`; };

export default class AgentUsage extends View {
  init(_props, cx) {
    this.usage = {};
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    const load = (key, fn) => cx.spawn(async (cx) => {
      try { this.usage[key] = await fn(); }
      catch (e) { this.usage[key] = { error: String(e?.message ?? e).slice(0, 80) }; }
      cx.notify();
    });
    load("codex", codexLimits);
    load("claude", claudeTokens);
  }

  // A 30px bar filled to the share used, in the same color as its number.
  meter(t, used, color) {
    const w = Math.max(0, Math.min(100, used)) * 0.3;
    return div().w(30).h(4).rounded(2).flex_none().bg(t.border).child(div().w(w).h(4).rounded(2).bg(color));
  }

  pct(t, w) {
    const color = w.used >= 90 ? t.blocked : w.used >= 70 ? t.working : t.muted;
    return h_flex().gap(5).items_center().tooltip(`${w.label === "5h" ? "5-hour" : "Weekly"} window: ${Math.round(w.used)}% used, resets in ${left(w.resetsAt)}`)
      .child(div().text_color(t.dim).child(w.label === "5h" ? "5h" : "week"))
      .child(this.meter(t, w.used, color))
      .child(div().text_color(color).child(`${Math.round(w.used)}%`));
  }

  codex(t) {
    const u = this.usage.codex;
    if (!u) return div().text_color(t.dim).child("Codex …");
    if (u.error) return div().text_color(t.dim).tooltip(u.error).child("Codex —");
    return h_flex().gap(10).items_center().child(div().text_color(t.foreground).font_medium().child("Codex")).children(u.windows.map((w) => this.pct(t, w)));
  }

  claude(t) {
    const u = this.usage.claude;
    if (!u) return div().text_color(t.dim).child("Claude …");
    const name = div().text_color(t.foreground).font_medium().child("Claude");
    if (u.limits) {
      const tok = u.error ? "" : ` ${compact(u.h5)} tokens in the last 5h, ${compact(u.day)} today.`;
      const ago = left(Date.now() + (Date.now() - u.limits.at));
      return h_flex().gap(10).items_center().tooltip(`Plan usage from Claude Code, last updated ${ago} ago.${tok}`)
        .child(name).children(u.limits.windows.map((w) => this.pct(t, w)));
    }
    if (u.error) return div().text_color(t.dim).tooltip(u.error).child("Claude —");
    const reset = u.first5 ? left(Date.parse(u.first5) + 5 * 3600 * 1000) : null;
    const stat = (label, n, tip) => h_flex().gap(5).items_center().tooltip(tip)
      .child(div().text_color(t.dim).child(label))
      .child(div().text_color(t.muted).child(`${compact(n)} tokens`));
    return h_flex().gap(10).items_center().child(name)
      .child(stat("5h", u.h5, reset ? `Last 5 hours, about ${reset} left. Plan percent appears after a Claude Code session reports it.` : "No Claude use in the last 5 hours"))
      .child(stat("today", u.day, "Since midnight, from your local Claude Code logs"));
  }

  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .child(this.claude(t))
      .child(this.codex(t))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
