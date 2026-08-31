import { execa, type Options as ExecaOptions } from "execa";
import { HarnessRunError } from "../types.js";

export interface ExecHarnessOptions {
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Piped to stdin if provided (used when a harness prefers stdin over an argv prompt). */
  input?: string;
  /** Set to "ignore" for harnesses (e.g. codex) that treat a connected-but-empty stdin as
   *  an extra "read additional input" block even though the prompt was already given as argv. */
  stdin?: "ignore";
}

export interface ExecHarnessResult {
  stdout: string;
  stderr: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes, matches team.yaml perTurnTimeoutMs default

/**
 * Shared subprocess wrapper for every harness adapter: normalizes timeouts, abort
 * signals, spawn errors and non-zero exit codes into a single HarnessRunError so
 * the orchestrator only ever has one error shape to render.
 */
export async function execHarness(
  binaryPath: string,
  args: string[],
  opts: ExecHarnessOptions,
): Promise<ExecHarnessResult> {
  const startedAt = Date.now();
  const execaOpts: ExecaOptions = {
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    cancelSignal: opts.signal,
    reject: false,
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}),
  };

  const result = await execa(binaryPath, args, execaOpts);
  const durationMs = Date.now() - startedAt;

  if (result.failed || result.timedOut || result.isCanceled) {
    const reason = result.timedOut
      ? `timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`
      : result.isCanceled
        ? "cancelled (interrupted)"
        : `exited with code ${String(result.exitCode)}`;
    throw new HarnessRunError(`${binaryPath} ${reason}`, {
      code: result.exitCode ?? undefined,
      stderr: typeof result.stderr === "string" ? result.stderr : undefined,
    });
  }

  return {
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    durationMs,
  };
}
