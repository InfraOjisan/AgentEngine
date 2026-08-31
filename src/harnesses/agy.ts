import type { HarnessAdapter, HarnessDetection, HarnessRunInput, HarnessRunResult } from "./types.js";
import { HarnessRunError } from "./types.js";
import { detectBinary, resolveBinFast } from "./util/resolveBin.js";
import { execHarness } from "./util/execHarness.js";

const BINARY_NAMES = ["agy"];

// Verified empirically against `agy -p ... --output-format json --mode plan`.
// agy has no --system-prompt equivalent (confirmed via `agy --help`), so the
// orchestrator is expected to fold the AGENT.md persona into `input.prompt` itself.
interface AgyJsonResult {
  response?: string;
  status?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  [key: string]: unknown;
}

export const agyAdapter: HarnessAdapter = {
  id: "agy",
  displayName: "Agy",
  binaryNames: BINARY_NAMES,

  async detect(): Promise<HarnessDetection> {
    return detectBinary(BINARY_NAMES);
  },

  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const binaryPath = await resolveBinFast(BINARY_NAMES);
    if (!binaryPath) {
      throw new HarnessRunError("agy binary not found on PATH");
    }

    const args = [
      "-p",
      input.prompt,
      "--output-format",
      "json",
      "--mode",
      input.toolsEnabled ? "accept-edits" : "plan",
    ];
    if (input.model) args.push("--model", input.model);

    const { stdout, durationMs } = await execHarness(binaryPath, args, {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });

    return parseAgyOutput(stdout, durationMs);
  },
};

function parseAgyOutput(stdout: string, durationMs: number): HarnessRunResult {
  try {
    const parsed = JSON.parse(stdout) as AgyJsonResult;
    const text = typeof parsed.response === "string" ? parsed.response : stdout.trim();
    const usage = parsed.usage
      ? {
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
          totalTokens: parsed.usage.total_tokens,
        }
      : undefined;
    return { text: text.trim(), raw: parsed, usage, durationMs };
  } catch {
    return { text: stdout.trim(), durationMs };
  }
}
