"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteDriver,
  listDrivers,
  upsertDriver,
  type Driver,
  type UpsertDriverInput,
} from "@/lib/driver-profiles";

export const driversKey = ["drivers"] as const;

export function useDrivers() {
  return useQuery({
    queryKey: driversKey,
    queryFn: listDrivers,
  });
}

export function useUpsertDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { characterId: string; input: UpsertDriverInput }) =>
      upsertDriver(vars.characterId, vars.input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: driversKey });
    },
  });
}

export function useDeleteDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (characterId: string) => deleteDriver(characterId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: driversKey });
    },
  });
}

export type { Driver };
