import type { HarnessAdapter, HarnessDetection, HarnessRunInput, HarnessRunResult } from "./types.js";
import { HarnessRunError } from "./types.js";
import { detectBinary, resolveBinFast } from "./util/resolveBin.js";
import { execHarness } from "./util/execHarness.js";

const BINARY_NAMES = ["qwen"];

// Qwen Code is a Gemini-CLI-derived tool. `--output-format json` returns a JSON *array*
// of NDJSON-style events (system/init, assistant, ..., result) rather than a single
// object — verified empirically. We pick out the `type: "result"` event.
// No --system-prompt equivalent is exposed, so the persona is folded into `input.prompt`.
// No workspace-trust gate was observed empirically (unlike gemini's --skip-trust
// requirement) so none is added here; revisit if that changes in a newer qwen version.
interface QwenResultEvent {
  type: "result";
  is_error?: boolean;
  result?: string;
  session_id?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  [key: string]: unknown;
}

export const qwenAdapter: HarnessAdapter = {
  id: "qwen",
  displayName: "Qwen Code",
  binaryNames: BINARY_NAMES,

  async detect(): Promise<HarnessDetection> {
    return detectBinary(BINARY_NAMES);
  },

  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const binaryPath = await resolveBinFast(BINARY_NAMES);
    if (!binaryPath) {
      throw new HarnessRunError("qwen binary not found on PATH");
    }

    const args = ["-p", input.prompt, "--output-format", "json"];
    if (input.model) args.push("--model", input.model);

    const { stdout, durationMs } = await execHarness(binaryPath, args, {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });

    return parseQwenOutput(stdout, durationMs);
  },
};

function parseQwenOutput(stdout: string, durationMs: number): HarnessRunResult {
  try {
    const events = JSON.parse(stdout) as unknown[];
    const resultEvent = events.find(
      (e): e is QwenResultEvent => typeof e === "object" && e !== null && (e as { type?: unknown }).type === "result",
    );
    if (!resultEvent) {
      return { text: stdout.trim(), raw: events, durationMs };
    }
    const text = typeof resultEvent.result === "string" ? resultEvent.result : "";
    if (resultEvent.is_error) {
      throw new HarnessRunError(text || "qwen reported an error result", { stderr: stdout });
    }
    const usage = resultEvent.usage
      ? {
          inputTokens: resultEvent.usage.input_tokens,
          outputTokens: resultEvent.usage.output_tokens,
        }
      : undefined;
    return { text: text.trim(), raw: resultEvent, sessionId: resultEvent.session_id, usage, durationMs };
  } catch (err) {
    if (err instanceof HarnessRunError) throw err;
    return { text: stdout.trim(), durationMs };
  }
}
