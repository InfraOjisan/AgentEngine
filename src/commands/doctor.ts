import { join } from "node:path";
import chalk from "chalk";
import { detectAll } from "../harnesses/registry.js";
import { loadTeam } from "../agents/loadTeam.js";
import { logger } from "../utils/logger.js";

export interface DoctorOptions {
  teamFile?: string;
  cwd?: string;
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const teamFilePath = opts.teamFile ?? join(cwd, "team.yaml");

  console.log(chalk.bold("Environment"));
  console.log(`Node: ${process.version}`);
  console.log(`PATH: ${process.env.PATH ?? "(unset)"}`);
  console.log();

  console.log(chalk.bold("Harness detection"));
  const rows = await detectAll();
  for (const { adapter, detection } of rows) {
    if (detection.available) {
      console.log(`${chalk.green("✔")} ${adapter.displayName} (${adapter.id}) — ${detection.version ?? "unknown"}`);
    } else {
      console.log(`${chalk.red("✖")} ${adapter.displayName} (${adapter.id}) — ${detection.error ?? "not available"}`);
    }
  }
  console.log();

  console.log(chalk.bold(`Team config (${teamFilePath})`));
  try {
    const { config, agents } = await loadTeam(teamFilePath);
    logger.ok(`team.yaml is valid — ${agents.length} agent(s), maxTurns=${config.maxTurns}`);

    const detectedIds = new Set(rows.filter((r) => r.detection.available).map((r) => r.adapter.id));
    let allHarnessesOk = true;
    for (const agent of agents) {
      const ok = detectedIds.has(agent.harness);
      if (!ok) allHarnessesOk = false;
      console.log(
        `  ${ok ? chalk.green("✔") : chalk.red("✖")} ${agent.id} (${agent.role}) -> ${agent.harness}${
          agent.model ? `/${agent.model}` : ""
        }${ok ? "" : chalk.red(" — harness not detected")}`,
      );
    }
    if (!allHarnessesOk) {
      logger.warn("Some agents reference a harness that isn't currently detected; `agentengine run` will refuse to start until that's fixed.");
    }
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    logger.warn('Run "agentengine init" to scaffold a starter team.yaml + AGENT.md set.');
  }
}
