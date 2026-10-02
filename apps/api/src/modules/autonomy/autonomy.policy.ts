export const AUTONOMY_VERSION = "autonomy.v1";

export type AutonomyBudgets = {
  readonly maxActionsPerTick: number;
  readonly maxMessagesPerTick: number;
  readonly maxEventsPerTick: number;
  readonly maxMemoryWritesPerTick: number;
  readonly maxRelationshipChangesPerTick: number;
  readonly maxAutonomousCharacters: number;
  readonly maxLlmCallsPerTick: number;
  readonly tickWindowHours: number;
};

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function autonomyBudgets(): AutonomyBudgets {
  return {
    maxActionsPerTick: readPositiveInt("AUTONOMY_MAX_ACTIONS_PER_TICK", 3),
    maxMessagesPerTick: readPositiveInt("AUTONOMY_MAX_MESSAGES_PER_TICK", 2),
    maxEventsPerTick: readPositiveInt("AUTONOMY_MAX_EVENTS_PER_TICK", 2),
    maxMemoryWritesPerTick: readPositiveInt("AUTONOMY_MAX_MEMORY_WRITES_PER_TICK", 2),
    maxRelationshipChangesPerTick: readPositiveInt(
      "AUTONOMY_MAX_RELATIONSHIP_CHANGES_PER_TICK",
      2,
    ),
    maxAutonomousCharacters: readPositiveInt("AUTONOMY_MAX_CHARACTERS_PER_TICK", 5),
    maxLlmCallsPerTick: readNonNegativeInt("AUTONOMY_MAX_LLM_CALLS_PER_TICK", 0),
    tickWindowHours: readPositiveInt("AUTONOMY_TICK_WINDOW_HOURS", 24),
  };
}
