import type { AgentConfig, TeamConfig } from "../agents/types.js";
import { executeTurn } from "./executeTurn.js";
import { RoundRobinSelector } from "./turnSelector.js";
import { designApprovalInstruction, hasControlLine, workDoneInstruction } from "./transcriptFormat.js";
import type { SessionBus, SessionEndReason, TranscriptEntry } from "./types.js";

export interface PhasedSessionOptions {
  task: string;
  /** Full roster; config.phases picks out which ids play which structural role. */
  team: AgentConfig[];
  /** Must have orchestration:"phased" and a `phases` block (validated by loadTeam). */
  config: TeamConfig;
  workspaceDir: string;
  bus: SessionBus;
  /** Drained at the top of every design-phase and work-phase iteration. In the design
   *  phase, a message that is exactly "/approve" additionally satisfies the human side
   *  of the approval gate — every drained message (including "/approve") is still pushed
   *  to the transcript as a visible [You] entry. */
  drainPendingUserMessages: () => string[];
  /** Whether a human is actually available to approve (Ink/TTY session). When false,
   *  requireHumanApproval is treated as auto-satisfied (with a printed notice) since
   *  there's no one to ask. */
  interactive: boolean;
  signal: AbortSignal;
  onEntry?: (entry: TranscriptEntry) => void | Promise<void>;
}

type WorkPhaseReason = "stop-keyword" | "max-turns" | "error-limit" | "interrupted";

/**
 * Dev-specialized orchestration for orchestration:"phased": a manager⇔designer approval
 * loop, then a worker round-robin, then a parallel reviewer/security-advisor pass whose
 * findings always return to the manager — repeating until a human ends the session or
 * `maxCycles` is hit. See phasedSession's design in the project plan for the full
 * rationale; this mirrors a small dev org where only the manager directs workers.
 */
export async function runPhasedSession(opts: PhasedSessionOptions): Promise<TranscriptEntry[]> {
  const { task, team, config, workspaceDir, bus, drainPendingUserMessages, interactive, signal, onEntry } = opts;
  const phases = config.phases;
  if (!phases) {
    throw new Error('runPhasedSession requires config.phases (orchestration:"phased")');
  }

  const byId = new Map(team.map((a) => [a.id, a]));
  const managerAgent = byId.get(phases.manager);
  const designerAgent = byId.get(phases.designer);
  const workerAgents = phases.workers.map((id) => byId.get(id)).filter((a): a is AgentConfig => Boolean(a));
  const reviewerAgents = phases.reviewers.map((id) => byId.get(id)).filter((a): a is AgentConfig => Boolean(a));

  const transcript: TranscriptEntry[] = [];
  const pushEntry = async (entry: TranscriptEntry) => {
    transcript.push(entry);
    bus.emit("entry-added", entry);
    if (onEntry) await onEntry(entry);
  };

  if (!managerAgent || !designerAgent || workerAgents.length === 0 || reviewerAgents.length === 0) {
    bus.emit("session-end", { reason: "no-agents" });
    return transcript;
  }

  const runTurn = async (
    agent: AgentConfig,
    closingInstruction: string | null,
    transcriptView: TranscriptEntry[] = transcript,
  ) => {
    bus.emit("turn-started", agent, Date.now());
    const result = await executeTurn(agent, {
      task,
      transcript: transcriptView,
      workspaceDir,
      perTurnTimeoutMs: config.perTurnTimeoutMs,
      closingInstruction,
      signal,
    });
    bus.emit("turn-ended", agent.id);
    return result;
  };
  const designInstruction = designApprovalInstruction(config.designApprovalKeyword);
  const workInstruction = workDoneInstruction(config.stopKeyword);

  /** Drains queued user messages into the transcript; returns true if "/approve" was among them. */
  const drainInto = async (): Promise<boolean> => {
    let approved = false;
    for (const injected of drainPendingUserMessages()) {
      if (injected.trim() === "/approve") approved = true;
      await pushEntry({ role: "user", speaker: "You", text: injected, ts: Date.now() });
    }
    return approved;
  };

  await pushEntry({ role: "user", speaker: "You", text: task, ts: Date.now() });

  if (config.requireHumanApproval && !interactive) {
    await pushEntry({
      role: "system",
      speaker: "system",
      text: `[非対話モードのため人間承認は収集できません。managerの承認（"${config.designApprovalKeyword}"）のみで設計フェーズを進めます]`,
      ts: Date.now(),
    });
  }

  let cycle = 0;
  let endReason: SessionEndReason = "max-cycles";

  outer: while (cycle < config.maxCycles) {
    if (signal.aborted) {
      endReason = "interrupted";
      break;
    }
    // Counted here — once per outer-loop pass — so a work phase that keeps failing
    // abnormally and looping back to design still exhausts maxCycles instead of retrying
    // forever (an abnormal pass doesn't get its own separate counter; it's still an
    // attempt at the design→work→review loop, which is exactly what maxCycles guards).
    cycle++;

    // ---- ① design phase: manager ⇔ designer until both manager and human approve ----
    bus.emit("phase-changed", { phase: "design", cycle });
    const designTeam = [managerAgent, designerAgent];
    const designSelector = new RoundRobinSelector();
    let designLastAgentId: string | undefined;
    let designApproved = false;
    let humanApproved = !config.requireHumanApproval || !interactive;
    let designTurns = 0;

    while (true) {
      if (signal.aborted) {
        endReason = "interrupted";
        break outer;
      }
      if (await drainInto()) humanApproved = true;
      if (signal.aborted) {
        endReason = "interrupted";
        break outer;
      }

      const agent = designSelector.next({ transcript, team: designTeam, lastAgentId: designLastAgentId });
      if (!agent) {
        endReason = "no-agents";
        break outer;
      }

      const { entry, aborted } = await runTurn(agent, designInstruction);
      await pushEntry(entry);
      designLastAgentId = agent.id;
      designTurns++;

      if (aborted) {
        endReason = "interrupted";
        break outer;
      }
      if (agent.id === managerAgent.id && hasControlLine(entry.text, config.designApprovalKeyword)) {
        designApproved = true;
      }
      if (designApproved && humanApproved) break;
      if (designTurns >= config.maxTurns) {
        endReason = "design-not-approved";
        break outer;
      }
    }

    // ---- ② work phase: worker round-robin ----
    bus.emit("phase-changed", { phase: "work", cycle });
    const workerSelector = new RoundRobinSelector();
    let workerLastAgentId: string | undefined;
    const workerFailures = new Map<string, number>();
    let workTurns = 0;
    let workReason: WorkPhaseReason | null = null;

    while (true) {
      if (signal.aborted) {
        workReason = "interrupted";
        break;
      }
      await drainInto(); // interjections are welcome during work too; no approval semantics here

      const agent = workerSelector.next({ transcript, team: workerAgents, lastAgentId: workerLastAgentId });
      if (!agent) {
        workReason = "error-limit";
        break;
      }

      const { entry, failed, aborted } = await runTurn(agent, workInstruction);
      await pushEntry(entry);
      workerLastAgentId = agent.id;
      workTurns++;

      if (aborted) {
        workReason = "interrupted";
        break;
      }
      if (!failed) {
        workerFailures.set(agent.id, 0);
        if (hasControlLine(entry.text, config.stopKeyword)) {
          workReason = "stop-keyword";
          break;
        }
      } else {
        const failures = (workerFailures.get(agent.id) ?? 0) + 1;
        workerFailures.set(agent.id, failures);
        if (config.onFailure === "halt" || failures >= 3) {
          workReason = "error-limit";
          break;
        }
      }
      if (workTurns >= config.maxTurns) {
        workReason = "max-turns";
        break;
      }
    }

    if (workReason === "interrupted") {
      endReason = "interrupted";
      break outer;
    }
    if (workReason !== "stop-keyword") {
      // Abnormal end of the work phase: explain why, then loop back to ① (same cycle —
      // it doesn't count against maxCycles, only a fully completed ①→②→③ pass does).
      await pushEntry({
        role: "system",
        speaker: "system",
        text: `[実装フェーズを${workReason === "max-turns" ? "ターン上限" : "エラー"}で中断し、設計フェーズへ差し戻します]`,
        ts: Date.now(),
      });
      continue;
    }

    // ---- ③ review phase: reviewer + security-advisor run concurrently ----
    bus.emit("phase-changed", { phase: "review", cycle });
    const transcriptSnapshot = transcript.slice(); // both reviewers see this same snapshot, not each other's output
    const reviewResults = await Promise.all(reviewerAgents.map((agent) => runTurn(agent, null, transcriptSnapshot)));
    for (const { entry, aborted } of reviewResults) {
      await pushEntry(entry);
      if (aborted) endReason = "interrupted";
    }
    if (endReason === "interrupted") break outer;

    // loop back to ① for the next design→work→review pass (cycle already counted above)
  }

  bus.emit("session-end", { reason: endReason });
  return transcript;
}
