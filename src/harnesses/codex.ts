import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessAdapter, HarnessDetection, HarnessRunInput, HarnessRunResult } from "./types.js";
import { HarnessRunError } from "./types.js";
import { detectBinary, resolveBinFast } from "./util/resolveBin.js";
import { execHarness } from "./util/execHarness.js";

const BINARY_NAMES = ["codex"];

// Codex CLI has no --system-prompt equivalent (confirmed via `codex exec --help`), so the
// orchestrator is expected to fold the AGENT.md persona into `input.prompt` itself; this
// adapter never uses `input.systemPrompt`.
export const codexAdapter: HarnessAdapter = {
  id: "codex",
  displayName: "OpenAI Codex CLI",
  binaryNames: BINARY_NAMES,

  async detect(): Promise<HarnessDetection> {
    return detectBinary(BINARY_NAMES);
  },

  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const binaryPath = await resolveBinFast(BINARY_NAMES);
    if (!binaryPath) {
      throw new HarnessRunError("codex binary not found on PATH");
    }

    // codex exec has no "print the reply to stdout cleanly" mode short of --json event
    // parsing, so we use --output-last-message to get just the final agent text via a
    // scratch file instead.
    const scratchDir = await mkdtemp(join(tmpdir(), "agentengine-codex-"));
    const outFile = join(scratchDir, "last-message.txt");

    const args = [
      "exec",
      input.prompt,
      "--cd",
      input.cwd,
      "--sandbox",
      input.toolsEnabled ? "workspace-write" : "read-only",
      "--skip-git-repo-check",
      "--output-last-message",
      outFile,
    ];
    if (input.model) args.push("--model", input.model);

    try {
      const { durationMs } = await execHarness(binaryPath, args, {
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
        // Without this, codex treats a connected-but-empty stdin as an extra "read
        // additional input" block even though the prompt was already passed as argv
        // (confirmed empirically) — pure noise appended to every single turn.
        stdin: "ignore",
      });
      const text = await readFile(outFile, "utf8").catch(() => "");
      return { text: text.trim(), durationMs };
    } finally {
      await rm(scratchDir, { recursive: true, force: true }).catch(() => {});
    }
  },
};
