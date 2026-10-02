export const WORLD_SIMULATION_VERSION = "world-simulation.v1";

export type WorldSimulationBudgets = {
  readonly maxEventsPerTick: number;
  readonly maxEventsPerCharacter: number;
  readonly staleRunningMs: number;
};

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function worldSimulationBudgets(): WorldSimulationBudgets {
  return {
    maxEventsPerTick: readPositiveInt("WORLD_SIM_MAX_EVENTS_PER_TICK", 8),
    maxEventsPerCharacter: readPositiveInt("WORLD_SIM_MAX_EVENTS_PER_CHARACTER", 2),
    staleRunningMs: readPositiveInt("WORLD_SIM_STALE_RUNNING_MS", 5 * 60 * 1000),
  };
}

export const UNAVAILABLE_STATUSES = new Set(["OFFLINE", "SLEEPING"]);
