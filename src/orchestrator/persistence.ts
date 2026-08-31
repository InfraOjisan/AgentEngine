import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentConfig, TeamConfig } from "../agents/types.js";
import type { TranscriptEntry } from "./types.js";

export interface SessionPaths {
  dir: string;
  transcriptJsonl: string;
  transcriptMarkdown: string;
  metaJson: string;
  workspaceDir: string;
}

export async function createSessionDir(baseDir: string): Promise<SessionPaths> {
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(baseDir, ".agentengine", "sessions", id);
  const workspaceDir = join(dir, "workspace");
  await mkdir(workspaceDir, { recursive: true });
  return {
    dir,
    transcriptJsonl: join(dir, "transcript.jsonl"),
    transcriptMarkdown: join(dir, "transcript.md"),
    metaJson: join(dir, "meta.json"),
    workspaceDir,
  };
}

export async function appendTranscriptEntry(paths: SessionPaths, entry: TranscriptEntry): Promise<void> {
  await appendFile(paths.transcriptJsonl, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function writeSessionMeta(
  paths: SessionPaths,
  info: { task: string; team: AgentConfig[]; config: TeamConfig; startedAt: number; harnessVersions: Record<string, string | undefined> },
): Promise<void> {
  await writeFile(paths.metaJson, JSON.stringify(info, null, 2), "utf8");
}

export async function writeTranscriptMarkdown(paths: SessionPaths, transcript: TranscriptEntry[]): Promise<void> {
  const lines = ["# AgentEngine session transcript", ""];
  for (const entry of transcript) {
    const time = new Date(entry.ts).toISOString();
    const source = entry.harnessId ? ` (${entry.harnessId}${entry.model ? `/${entry.model}` : ""})` : "";
    const tag = entry.error ? " ⚠️ ERROR" : entry.interrupted ? " ⏹ INTERRUPTED" : "";
    lines.push(`### ${entry.speaker}${source}${tag} — ${time}`, "", entry.text, "");
  }
  await writeFile(paths.transcriptMarkdown, lines.join("\n"), "utf8");
}
