import type { TranscriptEntry } from "./types.js";

const DEFAULT_MAX_CONTEXT_TURNS = 20;
const DEFAULT_MAX_CONTEXT_CHARS = 24_000;

function formatEntryLine(entry: TranscriptEntry): string {
  if (entry.role === "user") return `[${entry.speaker}] ${entry.text}`;
  const tag = entry.error ? " ERROR" : entry.interrupted ? " INTERRUPTED" : "";
  const source = entry.harnessId ? ` · ${entry.harnessId}${entry.model ? `/${entry.model}` : ""}` : "";
  return `[${entry.speaker}${source}${tag}] ${entry.text}`;
}

/**
 * Renders the visible transcript as a simple chat log for feeding back into the next
 * harness call. MVP truncation: keep the most recent N entries, then trim further by a
 * character budget if still too long. Summarization is a later concern (see plan doc).
 */
export function renderTranscript(
  transcript: TranscriptEntry[],
  opts: { maxTurns?: number; maxChars?: number } = {},
): string {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_CONTEXT_TURNS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS;

  const recent = transcript.slice(-maxTurns);
  const lines = recent.map(formatEntryLine);

  let rendered = lines.join("\n");
  while (rendered.length > maxChars && lines.length > 1) {
    lines.shift();
    rendered = lines.join("\n");
  }
  return rendered;
}

export function buildPromptForTurn(
  personaBody: string,
  task: string,
  transcript: TranscriptEntry[],
  stopKeyword: string,
): string {
  return [
    personaBody,
    "",
    `## Task\n${task}`,
    "",
    "## Conversation so far",
    renderTranscript(transcript) || "(no messages yet — you are speaking first)",
    "",
    `When you believe the discussion has reached a satisfactory conclusion for the current task, end your reply with the exact line \`${stopKeyword}\` on its own line. Otherwise, just contribute your turn — do not restate the whole conversation.`,
  ].join("\n");
}
