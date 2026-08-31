import type { HarnessAdapter, HarnessDetection, HarnessRunInput, HarnessRunResult } from "./types.js";
import { HarnessRunError } from "./types.js";
import { detectBinary, resolveBinFast } from "./util/resolveBin.js";
import { execHarness } from "./util/execHarness.js";

const BINARY_NAMES = ["pi"];

// pi supports a native --system-prompt/--append-system-prompt flag (unlike codex/qwen/
// opencode), so we use it the same way as the claude adapter. Its `--mode json` emits an
// NDJSON event stream rather than a single result object; for v1 we use the plain default
// text mode instead (verified empirically: clean stdout, no wrapping) and accept losing
// per-turn usage/cost — switch to parsing `--mode json`'s `agent_end.messages` if that
// becomes worth the complexity later.
export const piAdapter: HarnessAdapter = {
  id: "pi",
  displayName: "pi",
  binaryNames: BINARY_NAMES,

  async detect(): Promise<HarnessDetection> {
    return detectBinary(BINARY_NAMES);
  },

  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const binaryPath = await resolveBinFast(BINARY_NAMES);
    if (!binaryPath) {
      throw new HarnessRunError("pi binary not found on PATH");
    }

    const args = ["-p", input.prompt, "--no-session"];
    if (!input.toolsEnabled) args.push("--no-tools");
    if (input.model) args.push("--model", input.model);
    if (input.systemPrompt) args.push("--append-system-prompt", input.systemPrompt);

    const { stdout, durationMs } = await execHarness(binaryPath, args, {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });

    return { text: stdout.trim(), durationMs };
  },
};
