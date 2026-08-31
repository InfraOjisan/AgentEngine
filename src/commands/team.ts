import { join } from "node:path";
import chalk from "chalk";
import { loadTeam } from "../agents/loadTeam.js";

export interface TeamListOptions {
  teamFile?: string;
  cwd?: string;
}

export async function runTeamList(opts: TeamListOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const teamFilePath = opts.teamFile ?? join(cwd, "team.yaml");

  const { config, agents, teamFilePath: resolvedPath } = await loadTeam(teamFilePath);

  console.log(chalk.bold(`Team (${resolvedPath})`));
  console.log(
    chalk.dim(
      `maxTurns=${config.maxTurns} stopKeyword="${config.stopKeyword}" onFailure=${config.onFailure} turnSelector=${config.turnSelector}`,
    ),
  );
  console.log();

  for (const agent of agents) {
    const label = agent.displayName ?? `${agent.role} (${agent.harness})`;
    console.log(
      `${chalk.bold(label)}  ${chalk.dim(`id=${agent.id}`)}  harness=${agent.harness}${
        agent.model ? `/${agent.model}` : ""
      }  toolsEnabled=${agent.toolsEnabled}`,
    );
  }
}
