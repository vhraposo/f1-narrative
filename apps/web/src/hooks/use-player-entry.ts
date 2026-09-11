"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPlayerEntry,
  getPlayerEntrySetup,
  type PlayerEntryCreateInput,
  type PlayerEntryCreateResult,
  type PlayerEntrySeason,
  type PlayerEntrySeat,
  type PlayerEntrySelection,
  type PlayerEntrySetup,
  type PlayerEntryTeam,
} from "@/lib/player-entry";
import { charactersKey } from "./use-characters";
import { driversKey } from "./use-driver-profiles";

export const playerEntrySetupKey = ["player-entry", "setup"] as const;

export function usePlayerEntrySetup(seasonId?: string) {
  return useQuery<PlayerEntrySetup>({
    queryKey: [...playerEntrySetupKey, seasonId ?? "all"],
    queryFn: () => getPlayerEntrySetup(seasonId),
  });
}

export function useCreatePlayerEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PlayerEntryCreateInput) => createPlayerEntry(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: playerEntrySetupKey });
      void queryClient.invalidateQueries({ queryKey: charactersKey });
      void queryClient.invalidateQueries({ queryKey: driversKey });
    },
  });
}

export type {
  PlayerEntryCreateInput,
  PlayerEntryCreateResult,
  PlayerEntrySeason,
  PlayerEntrySeat,
  PlayerEntrySelection,
  PlayerEntrySetup,
  PlayerEntryTeam,
};