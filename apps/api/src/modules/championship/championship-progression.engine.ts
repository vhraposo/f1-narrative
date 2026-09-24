export const RACE_POINTS_TABLE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] as const;

export function pointsForPosition(
  position: number | null | undefined,
): number {
  if (position === null || position === undefined || position < 1) {
    return 0;
  }
  return RACE_POINTS_TABLE[position - 1] ?? 0;
}