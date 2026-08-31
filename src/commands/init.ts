import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { DEFAULT_AGENTS, defaultAgentMarkdown, defaultTeamYaml } from "../agents/defaults.js";
import { detectAll } from "../harnesses/registry.js";
import { logger } from "../utils/logger.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function writeIfAbsent(path: string, content: string, force: boolean): Promise<"created" | "skipped"> {
  if (!force && (await fileExists(path))) {
    return "skipped";
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return "created";
}

export interface InitOptions {
  force?: boolean;
  cwd?: string;
}

export async function runInit(opts: InitOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const force = opts.force ?? false;

  const teamYamlPath = join(cwd, "team.yaml");
  const teamResult = await writeIfAbsent(teamYamlPath, defaultTeamYaml(), force);
  logger[teamResult === "created" ? "ok" : "warn"](
    `team.yaml ${teamResult === "created" ? "created" : "already exists (use --force to overwrite)"}`,
  );

  for (const def of DEFAULT_AGENTS) {
    const agentPath = join(cwd, "agents", def.role, "AGENT.md");
    const result = await writeIfAbsent(agentPath, defaultAgentMarkdown(def), force);
    logger[result === "created" ? "ok" : "warn"](
      `agents/${def.role}/AGENT.md ${result === "created" ? "created" : "already exists"}`,
    );
  }

  const gitignorePath = join(cwd, ".gitignore");
  const gitignoreLine = ".agentengine/";
  const existing = (await fileExists(gitignorePath)) ? await readFile(gitignorePath, "utf8") : "";
  if (!existing.split("\n").includes(gitignoreLine)) {
    await writeFile(gitignorePath, existing.length > 0 ? `${existing.trimEnd()}\n${gitignoreLine}\n` : `${gitignoreLine}\n`, "utf8");
    logger.ok(".gitignore updated with .agentengine/");
  }

  console.log();
  console.log(chalk.bold("Harness detection"));
  const rows = await detectAll();
  for (const { adapter, detection } of rows) {
    if (detection.available) {
      console.log(`${chalk.green("✔")} ${adapter.displayName} — ${detection.version ?? "unknown version"}`);
    } else {
      console.log(`${chalk.red("✖")} ${adapter.displayName} — ${detection.error ?? "not available"}`);
    }
  }

  console.log();
  console.log(`Edit ${chalk.bold("team.yaml")} and ${chalk.bold("agents/*/AGENT.md")} to customize your team, then run:`);
  console.log(chalk.cyan("  agentengine run \"<task>\""));
}
