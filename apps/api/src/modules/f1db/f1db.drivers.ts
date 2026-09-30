import {
  getF1dbDataset,
  type F1dbDriver,
  type F1dbResult,
} from "./f1db.dataset.js";

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveF1dbDriver(input: {
  name: string;
  driverCode?: string | null;
  fullName?: string | null;
}): F1dbDriver | null {
  const dataset = getF1dbDataset();
  if (!dataset) return null;
  const names = [input.fullName, input.name]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map(normalizeName);
  for (const candidate of names) {
    const exact = dataset.drivers.find(
      (driver) =>
        normalizeName(driver.fullName) === candidate ||
        normalizeName(driver.name) === candidate,
    );
    if (exact) return exact;
  }
  const code = input.driverCode?.trim().toUpperCase() ?? "";
  if (code.length > 0) {
    const byCode = dataset.drivers.find(
      (driver) => driver.abbreviation.toUpperCase() === code,
    );
    if (byCode) return byCode;
  }
  for (const candidate of names) {
    const parts = candidate.split(" ").filter(Boolean);
    if (parts.length < 2) continue;
    const surname = parts[parts.length - 1] as string;
    const initial = (parts[0] as string).charAt(0);
    const match = dataset.drivers.find((driver) => {
      const driverNames = [driver.name, driver.fullName].map((value) =>
        normalizeName(value).split(" ").filter(Boolean),
      );
      return driverNames.some((driverParts) => {
        if (driverParts.length < 2) return false;
        return (
          driverParts[driverParts.length - 1] === surname &&
          (driverParts[0] as string).charAt(0) === initial
        );
      });
    });
    if (match) return match;
  }
  return null;
}

export type F1dbMilestonePoint = {
  readonly raceId: string;
  readonly year: number;
  readonly round: number;
};

export type F1dbDriverMilestones = {
  readonly debut: F1dbMilestonePoint | null;
  readonly firstPoints: F1dbMilestonePoint | null;
  readonly firstPodium: F1dbMilestonePoint | null;
  readonly firstPole: F1dbMilestonePoint | null;
  readonly firstWin: F1dbMilestonePoint | null;
  readonly firstFastestLap: F1dbMilestonePoint | null;
  readonly championshipYears: readonly number[];
};

function point(result: F1dbResult): F1dbMilestonePoint {
  return { raceId: result.raceId, year: result.year, round: result.round };
}

export function computeF1dbDriverMilestones(driverId: string): F1dbDriverMilestones | null {
  const dataset = getF1dbDataset();
  if (!dataset) return null;
  const results = dataset.resultsByDriverId.get(driverId);
  if (!results) return null;
  const first = results[0] ?? null;
  const firstPoints = results.find((result) => (result.points ?? 0) > 0) ?? null;
  const firstPodium =
    results.find(
      (result) =>
        result.positionNumber !== null &&
        result.positionNumber <= 3 &&
        !result.reasonRetired,
    ) ?? null;
  const firstPole = results.find((result) => result.polePosition) ?? null;
  const firstWin = results.find((result) => result.positionNumber === 1) ?? null;
  const firstFastestLap = results.find((result) => result.fastestLap) ?? null;
  const championshipYears = [...dataset.championsByYear.values()]
    .filter((champion) => champion.driverId === driverId)
    .map((champion) => champion.year)
    .sort((a, b) => a - b);

  return {
    debut: first ? point(first) : null,
    firstPoints: firstPoints ? point(firstPoints) : null,
    firstPodium: firstPodium ? point(firstPodium) : null,
    firstPole: firstPole ? point(firstPole) : null,
    firstWin: firstWin ? point(firstWin) : null,
    firstFastestLap: firstFastestLap ? point(firstFastestLap) : null,
    championshipYears,
  };
}

export type F1dbDriverStats = {
  readonly wins: number;
  readonly podiums: number;
  readonly poles: number;
  readonly fastestLaps: number;
  readonly titles: number;
  readonly starts: number;
};

export function getF1dbDriverStats(driver: F1dbDriver): F1dbDriverStats {
  return {
    wins: driver.totalRaceWins ?? 0,
    podiums: driver.totalPodiums ?? 0,
    poles: driver.totalPolePositions ?? 0,
    fastestLaps: driver.totalFastestLaps ?? 0,
    titles: driver.totalChampionshipWins ?? 0,
    starts: driver.totalRaceStarts ?? 0,
  };
}

export function getF1dbRaceLabel(raceId: string): string | null {
  const dataset = getF1dbDataset();
  const race = dataset?.racesById.get(raceId);
  if (!race) return null;
  return race.officialName ?? race.grandPrixId ?? null;
}

export function f1dbChampionForYear(
  year: number,
): { driverId: string; driverName: string } | null {
  const dataset = getF1dbDataset();
  const champion = dataset?.championsByYear.get(year);
  if (!champion) return null;
  const driver = dataset?.driversById.get(champion.driverId);
  return {
    driverId: champion.driverId,
    driverName: driver?.fullName ?? champion.driverId,
  };
}
