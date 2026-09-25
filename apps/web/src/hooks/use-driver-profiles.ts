"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteDriver,
  getDriver,
  listDrivers,
  updateDriver,
  upsertDriver,
  type Driver,
  type UpsertDriverInput,
} from "@/lib/driver-profiles";

export const driversKey = ["drivers"] as const;

export function driverKey(id: string) {
  return ["drivers", id] as const;
}

export function useDrivers() {
  return useQuery({
    queryKey: driversKey,
    queryFn: listDrivers,
  });
}

export function useDriver(id: string | undefined) {
  return useQuery({
    queryKey: driverKey(id ?? ""),
    queryFn: () => getDriver(id as string),
    enabled: Boolean(id),
  });
}

export function useUpdateDriver(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertDriverInput) => updateDriver(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: driversKey });
      void queryClient.invalidateQueries({ queryKey: driverKey(id) });
    },
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
