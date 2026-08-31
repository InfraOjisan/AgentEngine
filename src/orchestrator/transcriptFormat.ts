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

/**
 * True only if `keyword` appears as a standalone line (after trimming whitespace) — not
 * merely mentioned inline. A naive `text.includes(keyword)` false-positives whenever a
 * model quotes or references the control keyword while explaining that it does *not*
 * apply yet (e.g. "...I'll approve it with `<<DESIGN_APPROVED>>` once posted" — observed
 * empirically), which would wrongly fire a phase transition.
 */
export function hasControlLine(text: string, keyword: string): boolean {
  return text.split(/\r?\n/).some((line) => line.trim() === keyword);
}

export function buildPromptForTurn(
  personaBody: string,
  task: string,
  transcript: TranscriptEntry[],
  closingInstruction: string | null,
): string {
  return [
    personaBody,
    "",
    `## Task\n${task}`,
    "",
    "## Conversation so far",
    renderTranscript(transcript) || "(no messages yet — you are speaking first)",
    ...(closingInstruction ? ["", closingInstruction] : []),
  ].join("\n");
}

export function stopKeywordInstruction(stopKeyword: string): string {
  return `When you believe the discussion has reached a satisfactory conclusion for the current task, end your reply with the exact line \`${stopKeyword}\` on its own line, alone (not quoted or explained). Otherwise, just contribute your turn — do not restate the whole conversation.`;
}

export function designApprovalInstruction(designApprovalKeyword: string): string {
  return `Once the Manager (not the Designer) is satisfied the plan is ready to build, the Manager should end their reply with the exact line \`${designApprovalKeyword}\` on its own line, alone (not quoted or explained) — this hands the plan to the Workers. Otherwise, just contribute your turn.`;
}

export function workDoneInstruction(stopKeyword: string): string {
  return `When your assigned work (and peer-review pass) is complete, end your reply with the exact line \`${stopKeyword}\` on its own line, alone (not quoted or explained) — this moves the round to Review. Otherwise, just contribute your turn.`;
}
