import { getHarness } from "../harnesses/registry.js";
import { buildPromptForTurn } from "./transcriptFormat.js";
import type { AgentConfig } from "../agents/types.js";
import type { TranscriptEntry } from "./types.js";

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export interface ExecuteTurnContext {
  task: string;
  /** Transcript visible to this turn's prompt — callers may pass a snapshot narrower
   *  than the full session transcript (e.g. parallel review turns all see the same one). */
  transcript: TranscriptEntry[];
  workspaceDir: string;
  perTurnTimeoutMs: number;
  /** Appended after the transcript; null omits it entirely (e.g. the parallel review
   *  phase, where no control keyword applies). Callers build this per-phase — see
   *  transcriptFormat.ts's stopKeywordInstruction/designApprovalInstruction/workDoneInstruction. */
  closingInstruction: string | null;
  signal: AbortSignal;
}

export interface ExecuteTurnResult {
  entry: TranscriptEntry;
  /** True if the turn produced an [ERROR] entry (adapter threw, harness unregistered, etc). */
  failed: boolean;
  /** True if the failure was specifically due to the shared AbortSignal firing (Ctrl-C). */
  aborted: boolean;
}

/**
 * Runs a single agent's turn: builds its prompt from the persona + task + transcript,
 * calls its harness adapter, and normalizes the outcome into a TranscriptEntry. Does NOT
 * push to any transcript, count consecutive failures, or check the stop keyword — callers
 * (runSession's flat loop, phasedSession's phase loops) own that bookkeeping since it
 * differs per orchestration mode.
 */
export async function executeTurn(agent: AgentConfig, ctx: ExecuteTurnContext): Promise<ExecuteTurnResult> {
  const adapter = getHarness(agent.harness);
  if (!adapter) {
    // Should have been caught at load time (loadTeam cross-checks the registry), but
    // guard here too so a bad runtime team-swap can't crash the loop.
    return {
      failed: true,
      aborted: false,
      entry: {
        role: "system",
        speaker: agent.role,
        agentId: agent.id,
        text: `[ERROR] harness "${agent.harness}" is not registered`,
        ts: Date.now(),
        error: true,
      },
    };
  }

  const prompt = buildPromptForTurn(agent.systemPromptBody, ctx.task, ctx.transcript, ctx.closingInstruction);

  try {
    const result = await adapter.run({
      prompt,
      systemPrompt: agent.systemPromptBody,
      model: agent.model,
      cwd: ctx.workspaceDir,
      timeoutMs: ctx.perTurnTimeoutMs,
      signal: ctx.signal,
      toolsEnabled: agent.toolsEnabled,
    });

    return {
      failed: false,
      aborted: false,
      entry: {
        role: "agent",
        speaker: agent.displayName ?? agent.role,
        agentId: agent.id,
        harnessId: agent.harness,
        model: agent.model,
        text: result.text,
        usage: result.usage,
        costUsd: result.costUsd,
        ts: Date.now(),
      },
    };
  } catch (err) {
    const wasAborted = ctx.signal.aborted;
    return {
      failed: !wasAborted,
      aborted: wasAborted,
      entry: {
        role: "system",
        speaker: agent.displayName ?? agent.role,
        agentId: agent.id,
        harnessId: agent.harness,
        model: agent.model,
        text: wasAborted ? "[INTERRUPTED]" : `[ERROR] ${describeError(err)}`,
        ts: Date.now(),
        error: !wasAborted,
        interrupted: wasAborted,
      },
    };
  }
}
