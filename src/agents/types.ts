import { z } from "zod";

/**
 * Frontmatter of an AGENT.md file. This is the source of truth for role, harness,
 * model and toolsEnabled — team.yaml only lists ordering + session-wide settings,
 * to avoid the two files drifting out of sync.
 */
export const AgentFrontmatterSchema = z.object({
  role: z.string().min(1),
  harness: z.string().min(1),
  model: z.string().optional(),
  displayName: z.string().optional(),
  toolsEnabled: z.boolean().optional().default(false),
  /** Escape hatch: explicit binary path override, bypassing PATH lookup for this agent. */
  binPath: z.string().optional(),
});
export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;

/** A fully resolved team member: team.yaml's ordering entry + its AGENT.md's frontmatter + body. */
export interface AgentConfig extends AgentFrontmatter {
  id: string;
  agentFile: string;
  /** Markdown body of AGENT.md — the persona/system-prompt text. */
  systemPromptBody: string;
}

export const TeamAgentRefSchema = z.object({
  id: z.string().min(1),
  agentFile: z.string().min(1),
});
export type TeamAgentRef = z.infer<typeof TeamAgentRefSchema>;

export const TeamConfigSchema = z.object({
  version: z.literal(1),
  maxTurns: z.number().int().positive().default(20),
  stopKeyword: z.string().default("<<DONE>>"),
  perTurnTimeoutMs: z.number().int().positive().default(300_000),
  onFailure: z.enum(["skip", "halt"]).default("skip"),
  turnSelector: z.enum(["round-robin"]).default("round-robin"),
  agents: z.array(TeamAgentRefSchema).min(1),
});
export type TeamConfig = z.infer<typeof TeamConfigSchema>;
