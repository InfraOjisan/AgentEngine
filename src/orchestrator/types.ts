import type { AgentConfig, TeamConfig } from "../agents/types.js";
import type { HarnessUsage } from "../harnesses/types.js";

export interface TranscriptEntry {
  role: "user" | "agent" | "system";
  /** Display label: the human's name for 'user', the agent's role for 'agent'/'system'. */
  speaker: string;
  agentId?: string;
  harnessId?: string;
  model?: string;
  text: string;
  usage?: HarnessUsage;
  costUsd?: number;
  ts: number;
  error?: boolean;
  interrupted?: boolean;
}

export interface TurnSelectorState {
  transcript: TranscriptEntry[];
  team: AgentConfig[];
  lastAgentId?: string;
}

export interface TurnSelector {
  next(state: TurnSelectorState): AgentConfig | null;
}

export interface StatusEvent {
  agent: AgentConfig;
  state: "running";
  startedAt: number;
}

export type SessionEndReason = "max-turns" | "stop-keyword" | "error-limit" | "interrupted" | "no-agents";

export interface SessionBusEvents {
  "entry-added": (entry: TranscriptEntry) => void;
  "status-changed": (status: StatusEvent | null) => void;
  "session-end": (info: { reason: SessionEndReason }) => void;
}

/** Minimal typed pub/sub so the orchestrator has zero UI dependency — see orchestrator/session.ts.
 *  Storage is untyped internally (the usual escape hatch for a mapped-type event emitter);
 *  the public on()/emit() generics keep every call site fully type-checked. */
export class SessionBus {
  private listeners = new Map<keyof SessionBusEvents, Array<(...args: never[]) => void>>();

  on<K extends keyof SessionBusEvents>(event: K, listener: SessionBusEvents[K]): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(listener as (...args: never[]) => void);
    this.listeners.set(event, arr);
  }

  emit<K extends keyof SessionBusEvents>(event: K, ...args: Parameters<SessionBusEvents[K]>): void {
    const arr = this.listeners.get(event) ?? [];
    for (const listener of arr) {
      (listener as unknown as (...args: Parameters<SessionBusEvents[K]>) => void)(...args);
    }
  }
}

export interface SessionOptions {
  task: string;
  team: AgentConfig[];
  config: TeamConfig;
  workspaceDir: string;
  turnSelector: TurnSelector;
  bus: SessionBus;
  /** Called at the top of every loop iteration to drain any messages the user typed mid-session. */
  drainPendingUserMessages: () => string[];
  /** Resolved once per session; the same signal is passed to every harness call so a single
   *  Ctrl-C aborts whichever turn is currently in flight. */
  signal: AbortSignal;
  onEntry?: (entry: TranscriptEntry) => void | Promise<void>;
}
