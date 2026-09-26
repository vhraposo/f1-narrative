export const RACE_POINTS_TABLE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] as const;

export function pointsForPosition(
  position: number | null | undefined,
): number {
  if (position === null || position === undefined || position < 1) {
    return 0;
  }
  return RACE_POINTS_TABLE[position - 1] ?? 0;
}

export interface StandingResultRow {
  driverProfileId: string;
  position: number | null;
  driverName: string | null;
  teamId: string | null;
}

export interface StandingAggregate {
  driverProfileId: string;
  points: number;
  wins: number;
  podiums: number;
  rankName: string | null;
  teamId: string | null;
}

export function aggregateStandings(
  rows: readonly StandingResultRow[],
): StandingAggregate[] {
  const byDriver = new Map<string, StandingAggregate>();
  for (const row of rows) {
    const earned = pointsForPosition(row.position);
    const current =
      byDriver.get(row.driverProfileId) ??
      ({
        driverProfileId: row.driverProfileId,
        points: 0,
        wins: 0,
        podiums: 0,
        rankName: row.driverName,
        teamId: row.teamId,
      } satisfies StandingAggregate);
    current.points += earned;
    if (row.position === 1) current.wins += 1;
    if (row.position !== null && row.position >= 1 && row.position <= 3) {
      current.podiums += 1;
    }
    byDriver.set(row.driverProfileId, current);
  }
  return [...byDriver.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      b.podiums - a.podiums ||
      (a.rankName ?? "").localeCompare(b.rankName ?? "pt", "pt") ||
      a.driverProfileId.localeCompare(b.driverProfileId),
  );
}
