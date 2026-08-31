// Shared role -> color mapping for the default starter team. A custom team.yaml with
// different agent ids just falls back to white — acceptable for v1.
const ROLE_COLOR_NAMES: Record<string, string> = {
  manager: "cyan",
  designer: "blue",
  "builder-qwen": "green",
  "builder-pi": "magenta",
  "builder-opencode": "cyanBright",
  reviewer: "yellow",
  "security-advisor": "red",
};

export function colorNameForRole(agentId: string): string {
  return ROLE_COLOR_NAMES[agentId] ?? "white";
}
