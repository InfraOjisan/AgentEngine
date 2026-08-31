import { executeTurn } from "./executeTurn.js";
import { hasControlLine, stopKeywordInstruction } from "./transcriptFormat.js";
import type { SessionEndReason, SessionOptions, TranscriptEntry } from "./types.js";

/**
 * UI-independent main loop for orchestration:"round-robin" (the flat, general-purpose
 * mode): pulls a turn selection, runs that agent's harness via executeTurn(), appends the
 * result to the transcript, and repeats until a stop condition fires. Every side effect
 * (new transcript entry, turn start/end, session end) goes through `opts.bus` so a console
 * logger and the Ink UI can both subscribe without this file knowing either exists.
 *
 * For the dev-specialized manager→designer→worker→review flow, see phasedSession.ts —
 * this file's behavior is unchanged from before that mode existed.
 */
export async function runSession(opts: SessionOptions): Promise<TranscriptEntry[]> {
  const { task, team, config, workspaceDir, turnSelector, bus, drainPendingUserMessages, signal, onEntry } = opts;

  const transcript: TranscriptEntry[] = [];
  const pushEntry = async (entry: TranscriptEntry) => {
    transcript.push(entry);
    bus.emit("entry-added", entry);
    if (onEntry) await onEntry(entry);
  };

  await pushEntry({ role: "user", speaker: "You", text: task, ts: Date.now() });

  if (team.length === 0) {
    bus.emit("session-end", { reason: "no-agents" });
    return transcript;
  }

  let lastAgentId: string | undefined;
  const consecutiveFailures = new Map<string, number>();
  let turnIndex = 0;
  let endReason: SessionEndReason = "max-turns";
  const closingInstruction = stopKeywordInstruction(config.stopKeyword);

  while (turnIndex < config.maxTurns) {
    if (signal.aborted) {
      endReason = "interrupted";
      break;
    }

    for (const injected of drainPendingUserMessages()) {
      await pushEntry({ role: "user", speaker: "You", text: injected, ts: Date.now() });
    }

    const agent = turnSelector.next({ transcript, team, lastAgentId });
    if (!agent) {
      endReason = "no-agents";
      break;
    }

    bus.emit("turn-started", agent, Date.now());
    const { entry, failed, aborted } = await executeTurn(agent, {
      task,
      transcript,
      workspaceDir,
      perTurnTimeoutMs: config.perTurnTimeoutMs,
      closingInstruction,
      signal,
    });
    bus.emit("turn-ended", agent.id);
    await pushEntry(entry);

    lastAgentId = agent.id;
    turnIndex++;

    if (!failed && !aborted) {
      consecutiveFailures.set(agent.id, 0);
      if (hasControlLine(entry.text, config.stopKeyword)) {
        endReason = "stop-keyword";
        break;
      }
      continue;
    }

    if (aborted) {
      endReason = "interrupted";
      break;
    }

    const failures = (consecutiveFailures.get(agent.id) ?? 0) + 1;
    consecutiveFailures.set(agent.id, failures);
    if (config.onFailure === "halt" || failures >= 3) {
      endReason = "error-limit";
      break;
    }
  }

  bus.emit("session-end", { reason: endReason });
  return transcript;
}
