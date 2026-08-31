import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import type { AgentConfig, TeamConfig } from "../agents/types.js";
import { RoundRobinSelector } from "../orchestrator/turnSelector.js";
import { runSession } from "../orchestrator/session.js";
import { runPhasedSession } from "../orchestrator/phasedSession.js";
import { SessionBus, type SessionEndReason, type SessionPhase, type TranscriptEntry } from "../orchestrator/types.js";
import { appendTranscriptEntry, writeTranscriptMarkdown, type SessionPaths } from "../orchestrator/persistence.js";
import { colorNameForRole } from "./colors.js";

export interface AppProps {
  task: string;
  team: AgentConfig[];
  config: TeamConfig;
  sessionPaths: SessionPaths;
}

interface RunningTurn {
  agent: AgentConfig;
  startedAt: number;
}

const PHASE_LABELS: Record<SessionPhase, string> = {
  design: "① 設計 (manager ⇔ designer)",
  work: "② 実装 (worker round-robin)",
  review: "③ レビュー・セキュリティ監査 (並列)",
};

function ElapsedTimer({ startedAt }: { startedAt: number }): React.ReactElement {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  return <Text dimColor>{seconds}s</Text>;
}

function TranscriptLine({ entry }: { entry: TranscriptEntry }): React.ReactElement {
  const headerColor = entry.role === "user" ? "white" : colorNameForRole(entry.agentId ?? "");
  const source = entry.harnessId ? ` · ${entry.harnessId}${entry.model ? `/${entry.model}` : ""}` : "";
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={headerColor}>
        [{entry.speaker}
        {source}]
      </Text>
      <Text color={entry.error ? "red" : entry.interrupted ? "gray" : undefined}>{entry.text}</Text>
    </Box>
  );
}

export function App({ task, team, config, sessionPaths }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [running, setRunning] = useState<Map<string, RunningTurn>>(new Map());
  const [phaseInfo, setPhaseInfo] = useState<{ phase: SessionPhase; cycle: number } | null>(null);
  const [input, setInput] = useState("");
  const [ended, setEnded] = useState<SessionEndReason | null>(null);
  const pendingRef = useRef<string[]>([]);
  const abortControllerRef = useRef(new AbortController());
  const startedRef = useRef(false);
  const interactive = Boolean(process.stdin.isTTY);
  const isPhased = config.orchestration === "phased";

  useEffect(() => {
    if (startedRef.current) return; // guard against a double-invoke under React StrictMode-like re-renders
    startedRef.current = true;

    const bus = new SessionBus();
    bus.on("entry-added", (entry) => setEntries((prev) => [...prev, entry]));
    bus.on("turn-started", (agent, startedAt) => {
      setRunning((prev) => new Map(prev).set(agent.id, { agent, startedAt }));
    });
    bus.on("turn-ended", (agentId) => {
      setRunning((prev) => {
        if (!prev.has(agentId)) return prev;
        const next = new Map(prev);
        next.delete(agentId);
        return next;
      });
    });
    bus.on("phase-changed", (info) => setPhaseInfo(info));
    bus.on("session-end", ({ reason }) => setEnded(reason));

    const drainPendingUserMessages = () => {
      const drained = pendingRef.current;
      pendingRef.current = [];
      return drained;
    };
    const common = {
      task,
      team,
      config,
      workspaceDir: sessionPaths.workspaceDir,
      bus,
      drainPendingUserMessages,
      signal: abortControllerRef.current.signal,
      onEntry: (entry: TranscriptEntry) => appendTranscriptEntry(sessionPaths, entry),
    };
    const runner = isPhased
      ? runPhasedSession({ ...common, interactive })
      : runSession({ ...common, turnSelector: new RoundRobinSelector() });

    void runner.then(async (transcript) => {
      await writeTranscriptMarkdown(sessionPaths, transcript);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput(
    (char, key) => {
      if (key.ctrl && char === "c") {
        abortControllerRef.current.abort();
      }
    },
    { isActive: interactive },
  );

  const submit = useCallback((value: string) => {
    const trimmed = value.trim();
    setInput("");
    if (!trimmed) return;
    if (trimmed === "/quit") {
      abortControllerRef.current.abort();
      return;
    }
    // "/approve" is not special-cased here — it's queued like any other message and
    // phasedSession.ts recognizes it as the human side of the design-approval gate while
    // still rendering it as a normal [You] transcript entry.
    pendingRef.current.push(trimmed);
  }, []);

  useEffect(() => {
    if (ended) {
      const timer = setTimeout(() => exit(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [ended, exit]);

  const runningList = Array.from(running.values());

  return (
    <Box flexDirection="column">
      <Static items={entries}>{(entry, i) => <TranscriptLine key={i} entry={entry} />}</Static>

      {isPhased && phaseInfo && !ended && (
        <Box marginBottom={1}>
          <Text bold dimColor>
            ─── サイクル{phaseInfo.cycle} — {PHASE_LABELS[phaseInfo.phase]} ───
          </Text>
        </Box>
      )}

      {runningList.map(({ agent, startedAt }) => (
        <Box key={agent.id}>
          <Text dimColor>
            <Spinner type="dots" /> {agent.displayName ?? agent.role} (
            {agent.harness}
            {agent.model ? `/${agent.model}` : ""}) is thinking... <ElapsedTimer startedAt={startedAt} />
          </Text>
        </Box>
      ))}

      {ended && (
        <Box marginTop={1}>
          <Text dimColor>
            Session ended ({ended}). Saved to {sessionPaths.dir}
          </Text>
        </Box>
      )}

      {!ended && interactive && (
        <Box>
          <Text dimColor>&gt; </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={submit}
            placeholder={isPhased ? "type to interject, /approve to approve design, /quit to stop" : "type to interject, /quit to stop"}
          />
        </Box>
      )}
    </Box>
  );
}
