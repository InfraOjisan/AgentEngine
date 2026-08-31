import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { TeamConfigSchema, type AgentConfig, type TeamConfig } from "./types.js";
import { parseAgentFile } from "./frontmatter.js";
import { getHarness } from "../harnesses/registry.js";

export interface LoadedTeam {
  config: TeamConfig;
  agents: AgentConfig[];
  teamFilePath: string;
}

/**
 * Loads team.yaml plus every referenced AGENT.md, validates both against their zod
 * schemas, and cross-checks each agent's `harness` id against the adapter registry.
 * Collects *all* problems before throwing so a user fixing their config sees every
 * issue at once instead of one-at-a-time.
 */
export async function loadTeam(teamFilePath: string): Promise<LoadedTeam> {
  const absPath = resolve(teamFilePath);
  const raw = await readFile(absPath, "utf8");
  const parsedYaml = yaml.load(raw);
  const config = TeamConfigSchema.parse(parsedYaml);

  const baseDir = dirname(absPath);
  const agents: AgentConfig[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const ref of config.agents) {
    if (seenIds.has(ref.id)) {
      errors.push(`duplicate agent id "${ref.id}" in team.yaml`);
      continue;
    }
    seenIds.add(ref.id);

    const agentFilePath = resolve(baseDir, ref.agentFile);
    try {
      const { frontmatter, body } = await parseAgentFile(agentFilePath);
      if (!getHarness(frontmatter.harness)) {
        errors.push(
          `agent "${ref.id}" (${ref.agentFile}) references unknown harness "${frontmatter.harness}"`,
        );
        continue;
      }
      if (!body) {
        errors.push(`agent "${ref.id}" (${ref.agentFile}) has an empty persona body`);
        continue;
      }
      agents.push({ id: ref.id, agentFile: ref.agentFile, systemPromptBody: body, ...frontmatter });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`failed to load agent "${ref.id}" (${ref.agentFile}): ${message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`team config has ${errors.length} problem(s):\n- ${errors.join("\n- ")}`);
  }

  return { config, agents, teamFilePath: absPath };
}
