import { getHarness } from "../harnesses/registry.js";
import { buildPromptForTurn } from "./transcriptFormat.js";
import type { SessionEndReason, SessionOptions, TranscriptEntry } from "./types.js";

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * UI-independent main loop: pulls a turn selection, runs that agent's harness, appends
 * the result to the transcript, and repeats until a stop condition fires. Every side
 * effect (new transcript entry, status change, session end) goes through `opts.bus` so
 * a console logger and a future Ink dashboard can both subscribe without this file
 * knowing either exists.
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

    const adapter = getHarness(agent.harness);
    if (!adapter) {
      // Should have been caught at load time (loadTeam cross-checks the registry), but
      // guard here too so a bad runtime team-swap can't crash the loop.
      await pushEntry({
        role: "system",
        speaker: agent.role,
        agentId: agent.id,
        text: `[ERROR] harness "${agent.harness}" is not registered`,
        ts: Date.now(),
        error: true,
      });
      lastAgentId = agent.id;
      turnIndex++;
      continue;
    }

    bus.emit("status-changed", { agent, state: "running", startedAt: Date.now() });

    const prompt = buildPromptForTurn(agent.systemPromptBody, task, transcript, config.stopKeyword);

    try {
      const result = await adapter.run({
        prompt,
        systemPrompt: agent.systemPromptBody,
        model: agent.model,
        cwd: workspaceDir,
        timeoutMs: config.perTurnTimeoutMs,
        signal,
        toolsEnabled: agent.toolsEnabled,
      });

      consecutiveFailures.set(agent.id, 0);

      const entry: TranscriptEntry = {
        role: "agent",
        speaker: agent.displayName ?? agent.role,
        agentId: agent.id,
        harnessId: agent.harness,
        model: agent.model,
        text: result.text,
        usage: result.usage,
        costUsd: result.costUsd,
        ts: Date.now(),
      };
      await pushEntry(entry);

      if (result.text.includes(config.stopKeyword)) {
        endReason = "stop-keyword";
        bus.emit("status-changed", null);
        turnIndex++;
        break;
      }
    } catch (err) {
      const wasAborted = signal.aborted;
      const failures = (consecutiveFailures.get(agent.id) ?? 0) + 1;
      consecutiveFailures.set(agent.id, failures);

      await pushEntry({
        role: "system",
        speaker: agent.displayName ?? agent.role,
        agentId: agent.id,
        harnessId: agent.harness,
        model: agent.model,
        text: wasAborted ? "[INTERRUPTED]" : `[ERROR] ${describeError(err)}`,
        ts: Date.now(),
        error: !wasAborted,
        interrupted: wasAborted,
      });

      if (wasAborted) {
        endReason = "interrupted";
        bus.emit("status-changed", null);
        turnIndex++;
        break;
      }
      if (config.onFailure === "halt" || failures >= 3) {
        endReason = "error-limit";
        bus.emit("status-changed", null);
        turnIndex++;
        break;
      }
    }

    bus.emit("status-changed", null);
    lastAgentId = agent.id;
    turnIndex++;
  }

  bus.emit("session-end", { reason: endReason });
  return transcript;
}
