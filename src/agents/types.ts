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

/** Which agent id plays which structural role, for orchestration:"phased" only. */
export const PhaseTeamSchema = z.object({
  manager: z.string().min(1),
  designer: z.string().min(1),
  workers: z.array(z.string().min(1)).min(1),
  reviewers: z.array(z.string().min(1)).min(1),
});
export type PhaseTeam = z.infer<typeof PhaseTeamSchema>;

export const TeamConfigSchema = z
  .object({
    version: z.literal(1),
    /** "round-robin" (default, general-purpose): flat rotation through `agents` in order.
     *  "phased" (dev-specialized): manager⇔designer approval loop → worker rotation →
     *  parallel reviewer/security pass → back to manager. See PhaseTeamSchema. */
    orchestration: z.enum(["round-robin", "phased"]).default("round-robin"),
    maxTurns: z.number().int().positive().default(20),
    stopKeyword: z.string().default("<<DONE>>"),
    perTurnTimeoutMs: z.number().int().positive().default(300_000),
    onFailure: z.enum(["skip", "halt"]).default("skip"),
    turnSelector: z.enum(["round-robin"]).default("round-robin"),
    agents: z.array(TeamAgentRefSchema).min(1),
    // --- phased-orchestration-only fields (validated as required together below) ---
    /** Safety valve for the outer design→work→review loop; only used when orchestration:"phased". */
    maxCycles: z.number().int().positive().default(5),
    /** Manager's signal that the design is ready to hand off to workers (phased only). */
    designApprovalKeyword: z.string().default("<<DESIGN_APPROVED>>"),
    /** Phased only. In interactive (Ink/TTY) sessions, the human must also type `/approve`
     *  before the design phase advances. Non-interactive sessions have no one to ask, so
     *  this requirement is treated as auto-satisfied there (with a printed warning). */
    requireHumanApproval: z.boolean().default(true),
    phases: PhaseTeamSchema.optional(),
  })
  .refine((cfg) => cfg.orchestration !== "phased" || cfg.phases !== undefined, {
    message: 'orchestration:"phased" requires a `phases` block (manager/designer/workers/reviewers)',
    path: ["phases"],
  });
export type TeamConfig = z.infer<typeof TeamConfigSchema>;
