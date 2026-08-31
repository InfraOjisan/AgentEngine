import which from "which";
import { execa } from "execa";
import type { HarnessDetection } from "../types.js";

/**
 * Fast PATH-only lookup (pure JS, no subprocess). Used by the pre-flight check
 * in `agentengine run` where speed matters and a version string isn't needed.
 */
export async function resolveBinFast(binaryNames: string[], override?: string): Promise<string | undefined> {
  if (override) {
    try {
      return await which(override);
    } catch {
      return undefined;
    }
  }
  for (const name of binaryNames) {
    try {
      return await which(name);
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

/**
 * Full detection used by `doctor`/`init`/`detect`: resolves the binary on PATH,
 * then actually executes `<bin> --version` with a short timeout to confirm it
 * runs (catches broken symlinks / permission issues) and to surface a version string.
 */
export async function detectBinary(binaryNames: string[], override?: string): Promise<HarnessDetection> {
  const binaryPath = await resolveBinFast(binaryNames, override);
  if (!binaryPath) {
    return {
      available: false,
      error: `not found on PATH (looked for: ${override ?? binaryNames.join(", ")})`,
    };
  }

  try {
    const { stdout } = await execa(binaryPath, ["--version"], { timeout: 5000 });
    return { available: true, binaryPath, version: stdout.trim().split("\n")[0] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { available: false, binaryPath, error: `resolved but "--version" failed: ${message}` };
  }
}
