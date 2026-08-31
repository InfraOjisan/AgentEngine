#!/usr/bin/env node
import { Command } from "commander";
import { runDetect } from "./commands/detect.js";
import { runInit } from "./commands/init.js";
import { runDoctor } from "./commands/doctor.js";
import { runTeamList } from "./commands/team.js";
import { runRun } from "./commands/run.js";

const program = new Command();

program
  .name("agentengine")
  .description("Multi-harness multi-agent team CUI — Claude Code / Codex CLI / Gemini CLI as one team.")
  .version("0.1.0");

program
  .command("detect")
  .description("List installed harnesses found on PATH")
  .action(async () => {
    await runDetect();
  });

program
  .command("init")
  .description("Scaffold team.yaml + default agents/*/AGENT.md files")
  .option("--force", "overwrite existing team.yaml/AGENT.md files")
  .action(async (options: { force?: boolean }) => {
    await runInit({ force: options.force });
  });

program
  .command("doctor")
  .description("Check harness detection + validate team.yaml/AGENT.md")
  .option("--team-file <path>", "path to team.yaml")
  .action(async (options: { teamFile?: string }) => {
    await runDoctor({ teamFile: options.teamFile });
  });

const team = program.command("team").description("Team configuration commands");
team
  .command("list")
  .description("Show the configured team (role, harness, model)")
  .option("--team-file <path>", "path to team.yaml")
  .action(async (options: { teamFile?: string }) => {
    await runTeamList({ teamFile: options.teamFile });
  });

program
  .command("run <task>")
  .description("Start a team session on a task, rendered as a shared chat transcript")
  .option("--team-file <path>", "path to team.yaml")
  .action(async (task: string, options: { teamFile?: string }) => {
    await runRun(task, { teamFile: options.teamFile });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
