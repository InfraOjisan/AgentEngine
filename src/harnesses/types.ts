/**
 * Common contract every harness adapter (Claude Code, Codex CLI, Gemini CLI, ...)
 * implements. The orchestrator only ever talks to this interface — it never knows
 * about a specific CLI's flags.
 */

export interface HarnessRunInput {
  /** Fully assembled prompt text (role persona + task + transcript context already folded in). */
  prompt: string;
  /** Used by adapters that support a native system-prompt flag (Claude); others ignore it since
   *  the caller already folded the persona into `prompt`. */
  systemPrompt?: string;
  /** Model id or alias to pass to the harness. Omit to use the harness's own default. */
  model?: string;
  /** Working directory the subprocess is spawned in (a per-session scratch workspace). */
  cwd: string;
  /** Per-turn timeout in ms. */
  timeoutMs?: number;
  /** Native harness session id, for future --resume/--continue support. */
  sessionId?: string;
  /** Abort signal wired to Ctrl-C / user interrupt. */
  signal?: AbortSignal;
  /** false (default) = safe/plan/read-only mode, no file mutation. true = allow tool/file edits. */
  toolsEnabled?: boolean;
}

export interface HarnessUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface HarnessRunResult {
  text: string;
  /** Parsed JSON payload if the harness returned structured output, for debugging. */
  raw?: unknown;
  usage?: HarnessUsage;
  costUsd?: number;
  sessionId?: string;
  durationMs: number;
}

export interface HarnessDetection {
  available: boolean;
  binaryPath?: string;
  version?: string;
  error?: string;
}

export interface HarnessAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly binaryNames: string[];
  detect(): Promise<HarnessDetection>;
  run(input: HarnessRunInput): Promise<HarnessRunResult>;
}

export class HarnessRunError extends Error {
  code?: string | number;
  stderr?: string;

  constructor(message: string, opts?: { code?: string | number; stderr?: string; cause?: unknown }) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "HarnessRunError";
    this.code = opts?.code;
    this.stderr = opts?.stderr;
  }
}
