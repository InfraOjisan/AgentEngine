import type { TurnSelector, TurnSelectorState } from "./types.js";
import type { AgentConfig } from "../agents/types.js";

/** v1 turn selection: cycle through team.yaml's agent order, forever. */
export class RoundRobinSelector implements TurnSelector {
  next(state: TurnSelectorState): AgentConfig | null {
    const { team, lastAgentId } = state;
    if (team.length === 0) return null;
    if (!lastAgentId) return team[0]!;

    const lastIndex = team.findIndex((a) => a.id === lastAgentId);
    const nextIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % team.length;
    return team[nextIndex]!;
  }
}
