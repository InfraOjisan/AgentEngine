import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import type { AgentConfig, TeamConfig } from "../agents/types.js";
import { RoundRobinSelector } from "../orchestrator/turnSelector.js";
import { runSession } from "../orchestrator/session.js";
import { SessionBus, type SessionEndReason, type StatusEvent, type TranscriptEntry } from "../orchestrator/types.js";
import { appendTranscriptEntry, writeTranscriptMarkdown, type SessionPaths } from "../orchestrator/persistence.js";
import { colorNameForRole } from "./colors.js";

export interface AppProps {
  task: string;
  team: AgentConfig[];
  config: TeamConfig;
  sessionPaths: SessionPaths;
}

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
  const [status, setStatus] = useState<StatusEvent | null>(null);
  const [input, setInput] = useState("");
  const [ended, setEnded] = useState<SessionEndReason | null>(null);
  const pendingRef = useRef<string[]>([]);
  const abortControllerRef = useRef(new AbortController());
  const startedRef = useRef(false);
  const interactive = Boolean(process.stdin.isTTY);

  useEffect(() => {
    if (startedRef.current) return; // guard against a double-invoke under React StrictMode-like re-renders
    startedRef.current = true;

    const bus = new SessionBus();
    bus.on("entry-added", (entry) => setEntries((prev) => [...prev, entry]));
    bus.on("status-changed", (s) => setStatus(s));
    bus.on("session-end", ({ reason }) => setEnded(reason));

    void runSession({
      task,
      team,
      config,
      workspaceDir: sessionPaths.workspaceDir,
      turnSelector: new RoundRobinSelector(),
      bus,
      drainPendingUserMessages: () => {
        const drained = pendingRef.current;
        pendingRef.current = [];
        return drained;
      },
      signal: abortControllerRef.current.signal,
      onEntry: (entry) => appendTranscriptEntry(sessionPaths, entry),
    }).then(async (transcript) => {
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
    pendingRef.current.push(trimmed);
  }, []);

  useEffect(() => {
    if (ended) {
      const timer = setTimeout(() => exit(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [ended, exit]);

  return (
    <Box flexDirection="column">
      <Static items={entries}>{(entry, i) => <TranscriptLine key={i} entry={entry} />}</Static>

      {status && (
        <Box>
          <Text dimColor>
            <Spinner type="dots" /> {status.agent.displayName ?? status.agent.role} (
            {status.agent.harness}
            {status.agent.model ? `/${status.agent.model}` : ""}) is thinking... <ElapsedTimer startedAt={status.startedAt} />
          </Text>
        </Box>
      )}

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
          <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder="type to interject, /quit to stop" />
        </Box>
      )}
    </Box>
  );
}
