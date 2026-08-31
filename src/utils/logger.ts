import chalk from "chalk";

export const logger = {
  info(msg: string): void {
    console.log(msg);
  },
  ok(msg: string): void {
    console.log(chalk.green("✔"), msg);
  },
  warn(msg: string): void {
    console.warn(chalk.yellow("⚠"), msg);
  },
  error(msg: string): void {
    console.error(chalk.red("✖"), msg);
  },
};
