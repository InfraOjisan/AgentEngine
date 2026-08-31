import chalk from "chalk";
import { detectAll } from "../harnesses/registry.js";

export async function runDetect(): Promise<void> {
  const rows = await detectAll();

  console.log(chalk.bold("Harness detection"));
  console.log(chalk.dim(`PATH: ${process.env.PATH ?? "(unset)"}`));
  console.log();

  for (const { adapter, detection } of rows) {
    if (detection.available) {
      console.log(
        `${chalk.green("✔")} ${chalk.bold(adapter.displayName)} ${chalk.dim(`(${adapter.id})`)} — ${detection.version ?? "unknown version"} ${chalk.dim(detection.binaryPath ?? "")}`,
      );
    } else {
      console.log(
        `${chalk.red("✖")} ${chalk.bold(adapter.displayName)} ${chalk.dim(`(${adapter.id})`)} — ${detection.error ?? "not available"}`,
      );
    }
  }

  const missing = rows.filter((r) => !r.detection.available);
  console.log();
  if (missing.length === 0) {
    console.log(chalk.green(`All ${rows.length} known harnesses detected.`));
  } else {
    console.log(
      chalk.yellow(
        `${missing.length}/${rows.length} harness(es) not detected. If a harness is installed but not found, ` +
          `make sure its install directory is on this shell's PATH (a GUI-launched terminal may not source ` +
          `.zshrc/.zprofile the same way an interactive login shell does).`,
      ),
    );
  }
}
