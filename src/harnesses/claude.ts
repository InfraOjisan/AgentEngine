import type { HarnessAdapter, HarnessDetection, HarnessRunInput, HarnessRunResult } from "./types.js";
import { HarnessRunError } from "./types.js";
import { detectBinary, resolveBinFast } from "./util/resolveBin.js";
import { execHarness } from "./util/execHarness.js";

const BINARY_NAMES = ["claude"];

// Verified empirically against `claude -p ... --output-format json` — see Milestone 2 notes.
interface ClaudeJsonResult {
  result?: string;
  total_cost_usd?: number;
  session_id?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  [key: string]: unknown;
}

export const claudeAdapter: HarnessAdapter = {
  id: "claude",
  displayName: "Claude Code",
  binaryNames: BINARY_NAMES,

  async detect(): Promise<HarnessDetection> {
    return detectBinary(BINARY_NAMES);
  },

  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const binaryPath = await resolveBinFast(BINARY_NAMES);
    if (!binaryPath) {
      throw new HarnessRunError("claude binary not found on PATH");
    }

    const args = [
      "-p",
      input.prompt,
      "--output-format",
      "json",
      "--permission-mode",
      input.toolsEnabled ? "acceptEdits" : "plan",
      "--no-session-persistence",
    ];
    if (input.model) args.push("--model", input.model);
    if (input.systemPrompt) args.push("--append-system-prompt", input.systemPrompt);

    const { stdout, durationMs } = await execHarness(binaryPath, args, {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });

    return parseClaudeOutput(stdout, durationMs);
  },
};

function parseClaudeOutput(stdout: string, durationMs: number): HarnessRunResult {
  try {
    const parsed = JSON.parse(stdout) as ClaudeJsonResult;
    const text = typeof parsed.result === "string" ? parsed.result : stdout.trim();
    const usage = parsed.usage
      ? {
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
          totalTokens:
            parsed.usage.input_tokens !== undefined && parsed.usage.output_tokens !== undefined
              ? parsed.usage.input_tokens + parsed.usage.output_tokens
              : undefined,
        }
      : undefined;
    return {
      text,
      raw: parsed,
      costUsd: parsed.total_cost_usd,
      sessionId: parsed.session_id,
      usage,
      durationMs,
    };
  } catch {
    // --output-format json didn't return parseable JSON — fall back to raw text
    // rather than losing the turn.
    return { text: stdout.trim(), durationMs };
  }
}
