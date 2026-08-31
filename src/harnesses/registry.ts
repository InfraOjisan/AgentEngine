import type { HarnessAdapter, HarnessDetection } from "./types.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { agyAdapter } from "./agy.js";
import { qwenAdapter } from "./qwen.js";
import { piAdapter } from "./pi.js";
import { opencodeAdapter } from "./opencode.js";

export const HARNESS_REGISTRY: Record<string, HarnessAdapter> = {
  [claudeAdapter.id]: claudeAdapter,
  [codexAdapter.id]: codexAdapter,
  [agyAdapter.id]: agyAdapter,
  [qwenAdapter.id]: qwenAdapter,
  [piAdapter.id]: piAdapter,
  [opencodeAdapter.id]: opencodeAdapter,
};

export function getHarness(id: string): HarnessAdapter | undefined {
  return HARNESS_REGISTRY[id];
}

export function listHarnesses(): HarnessAdapter[] {
  return Object.values(HARNESS_REGISTRY);
}

export interface HarnessDetectionRow {
  adapter: HarnessAdapter;
  detection: HarnessDetection;
}

export async function detectAll(): Promise<HarnessDetectionRow[]> {
  const adapters = listHarnesses();
  const detections = await Promise.all(adapters.map((a) => a.detect()));
  return adapters.map((adapter, i) => ({ adapter, detection: detections[i]! }));
}
