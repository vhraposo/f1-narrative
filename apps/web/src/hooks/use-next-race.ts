"use client";

import { useQuery } from "@tanstack/react-query";
import { getNextRace, type NextRaceResult } from "@/lib/next-race";

export const nextRaceKey = ["next-race"] as const;

export function useNextRace() {
  return useQuery<NextRaceResult>({
    queryKey: nextRaceKey,
    queryFn: getNextRace,
  });
}
