import { join } from "node:path";
import chalk, { type ChalkInstance } from "chalk";
import { loadTeam } from "../agents/loadTeam.js";
import type { AgentConfig, TeamConfig } from "../agents/types.js";
import { detectAll } from "../harnesses/registry.js";
import { RoundRobinSelector } from "../orchestrator/turnSelector.js";
import { runSession } from "../orchestrator/session.js";
import { runPhasedSession } from "../orchestrator/phasedSession.js";
import { SessionBus, type SessionPhase, type TranscriptEntry } from "../orchestrator/types.js";
import {
  appendTranscriptEntry,
  createSessionDir,
  writeSessionMeta,
  writeTranscriptMarkdown,
  type SessionPaths,
} from "../orchestrator/persistence.js";
import { logger } from "../utils/logger.js";

export interface RunOptions {
  teamFile?: string;
  cwd?: string;
}

interface PreparedRun {
  config: TeamConfig;
  agents: AgentConfig[];
  sessionPaths: SessionPaths;
}

/** Shared by both the console fallback and the Ink UI: load + validate the team, fail
 *  fast if any referenced harness isn't detected, then set up the session directory. */
async function prepareRun(task: string, opts: RunOptions): Promise<PreparedRun> {
  const cwd = opts.cwd ?? process.cwd();
  const teamFilePath = opts.teamFile ?? join(cwd, "team.yaml");

  const { config, agents } = await loadTeam(teamFilePath);

  const detections = await detectAll();
  const detectedIds = new Set(detections.filter((r) => r.detection.available).map((r) => r.adapter.id));
  const missing = agents.filter((a) => !detectedIds.has(a.harness));
  if (missing.length > 0) {
    const lines = missing.map(
      (a) => `  - agent "${a.id}" (role: ${a.role}) needs harness "${a.harness}", which was not detected`,
    );
    throw new Error(
      `Cannot start: ${missing.length} agent(s) reference an undetected harness.\n${lines.join("\n")}\nRun "agentengine doctor" for details.`,
    );
  }

  const sessionPaths = await createSessionDir(cwd);
  const harnessVersions = Object.fromEntries(detections.map((r) => [r.adapter.id, r.detection.version]));
  await writeSessionMeta(sessionPaths, { task, team: agents, config, startedAt: Date.now(), harnessVersions });

  return { config, agents, sessionPaths };
}

const ROLE_COLORS: Record<string, ChalkInstance> = {
  manager: chalk.cyan,
  designer: chalk.blue,
  "worker-qwen": chalk.green,
  "worker-pi": chalk.magenta,
  "worker-opencode": chalk.cyanBright,
  reviewer: chalk.yellow,
  "security-advisor": chalk.red,
};

function colorFor(role: string): ChalkInstance {
  return ROLE_COLORS[role] ?? chalk.white;
}

function printEntry(entry: TranscriptEntry): void {
  if (entry.role === "user") {
    console.log(chalk.bold.white(`\n[You]`), entry.text);
    return;
  }
  const color = colorFor(entry.agentId ?? "");
  const source = entry.harnessId ? chalk.dim(` (${entry.harnessId}${entry.model ? `/${entry.model}` : ""})`) : "";
  if (entry.error) {
    console.log(color.bold(`\n[${entry.speaker}]`) + source, chalk.red(entry.text));
  } else if (entry.interrupted) {
    console.log(color.bold(`\n[${entry.speaker}]`) + source, chalk.gray(entry.text));
  } else {
    console.log(color.bold(`\n[${entry.speaker}]`) + source, entry.text);
  }
}

const PHASE_LABELS: Record<SessionPhase, string> = {
  design: "① 設計 (manager ⇔ designer)",
  work: "② 実装 (worker round-robin)",
  review: "③ レビュー・セキュリティ監査 (並列)",
};

/** Non-interactive fallback: plain console output, no live input box. Used automatically
 *  when stdout/stdin isn't a TTY (piped, CI, this repo's own automated smoke tests), and
 *  always available directly for scripting. Human approval in "phased" mode is treated as
 *  auto-satisfied here since there's no live human to ask (see phasedSession.ts). */
export async function runRunConsole(task: string, opts: RunOptions = {}): Promise<void> {
  const { config, agents, sessionPaths } = await prepareRun(task, opts);

  const bus = new SessionBus();
  bus.on("entry-added", printEntry);
  bus.on("turn-started", (agent) => {
    console.log(
      chalk.dim(
        `\n▶ ${agent.displayName ?? agent.role} (${agent.harness}${agent.model ? `/${agent.model}` : ""}) is thinking...`,
      ),
    );
  });
  bus.on("phase-changed", ({ phase, cycle }) => {
    console.log(chalk.bold.dim(`\n─── サイクル${cycle} — ${PHASE_LABELS[phase]} ───`));
  });
  bus.on("session-end", ({ reason }) => {
    console.log(chalk.dim(`\nSession ended (${reason}).`));
  });

  const controller = new AbortController();
  const sigintHandler = () => controller.abort();
  process.on("SIGINT", sigintHandler);

  let transcript: TranscriptEntry[] = [];
  try {
    const common = {
      task,
      team: agents,
      config,
      workspaceDir: sessionPaths.workspaceDir,
      bus,
      drainPendingUserMessages: () => [],
      signal: controller.signal,
      onEntry: (entry: TranscriptEntry) => appendTranscriptEntry(sessionPaths, entry),
    };
    transcript =
      config.orchestration === "phased"
        ? await runPhasedSession({ ...common, interactive: false })
        : await runSession({ ...common, turnSelector: new RoundRobinSelector() });
  } finally {
    process.off("SIGINT", sigintHandler);
    await writeTranscriptMarkdown(sessionPaths, transcript);
  }

  console.log();
  logger.ok(`Session saved to ${sessionPaths.dir}`);
}

/** Interactive Ink UI: live chat transcript + status line + input box for mid-session
 *  interjection. Only usable when stdout/stdin are real TTYs. */
export async function runRunInteractive(task: string, opts: RunOptions = {}): Promise<void> {
  const { config, agents, sessionPaths } = await prepareRun(task, opts);

  const { render } = await import("ink");
  const React = await import("react");
  const { App } = await import("../ui/App.js");

  const { waitUntilExit } = render(React.createElement(App, { task, team: agents, config, sessionPaths }));
  await waitUntilExit();

  console.log();
  logger.ok(`Session saved to ${sessionPaths.dir}`);
}

export async function runRun(task: string, opts: RunOptions = {}): Promise<void> {
  const interactive = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  if (interactive) {
    await runRunInteractive(task, opts);
  } else {
    await runRunConsole(task, opts);
  }
}
