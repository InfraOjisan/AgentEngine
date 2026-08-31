import type { HarnessAdapter, HarnessDetection, HarnessRunInput, HarnessRunResult } from "./types.js";
import { HarnessRunError } from "./types.js";
import { detectBinary, resolveBinFast } from "./util/resolveBin.js";
import { execHarness } from "./util/execHarness.js";

const BINARY_NAMES = ["opencode"];

// `opencode run --format json` emits one JSON object per line (NDJSON) — verified
// empirically: "text" events carry the final answer text (not incremental deltas, unlike
// pi's stream) and the last "step_finish" event carries token/cost totals.
// No --system-prompt equivalent is exposed, so the persona is folded into `input.prompt`.
interface OpencodeTextEvent {
  type: "text";
  part?: { text?: string };
}
interface OpencodeStepFinishEvent {
  type: "step_finish";
  part?: { tokens?: { total?: number; input?: number; output?: number }; cost?: number };
}

export const opencodeAdapter: HarnessAdapter = {
  id: "opencode",
  displayName: "opencode",
  binaryNames: BINARY_NAMES,

  async detect(): Promise<HarnessDetection> {
    return detectBinary(BINARY_NAMES);
  },

  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const binaryPath = await resolveBinFast(BINARY_NAMES);
    if (!binaryPath) {
      throw new HarnessRunError("opencode binary not found on PATH");
    }

    const args = ["run", input.prompt, "--format", "json"];
    if (input.model) args.push("--model", input.model);
    // Default (no --auto) requires interactive per-tool approval, which would hang a
    // headless call — only opt in when the team config explicitly enables tools.
    if (input.toolsEnabled) args.push("--auto");

    const { stdout, durationMs } = await execHarness(binaryPath, args, {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });

    return parseOpencodeOutput(stdout, durationMs);
  },
};

function parseOpencodeOutput(stdout: string, durationMs: number): HarnessRunResult {
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  const textParts: string[] = [];
  let usage: HarnessRunResult["usage"];
  let costUsd: number | undefined;

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // tolerate stray non-JSON lines rather than failing the whole turn
    }
    if (typeof event !== "object" || event === null) continue;
    const type = (event as { type?: unknown }).type;
    if (type === "text") {
      const text = (event as OpencodeTextEvent).part?.text;
      if (text) textParts.push(text);
    } else if (type === "step_finish") {
      const part = (event as OpencodeStepFinishEvent).part;
      if (part?.tokens) {
        usage = {
          inputTokens: part.tokens.input,
          outputTokens: part.tokens.output,
          totalTokens: part.tokens.total,
        };
      }
      if (typeof part?.cost === "number") costUsd = part.cost;
    }
  }

  if (textParts.length === 0) {
    return { text: stdout.trim(), durationMs };
  }
  return { text: textParts.join("").trim(), usage, costUsd, durationMs };
}
