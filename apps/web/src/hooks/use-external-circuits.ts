"use client";

import { useQuery } from "@tanstack/react-query";

import {
  getExternalCircuitDetail,
  listExternalCircuits,
} from "@/lib/external-circuits";

export function externalCircuitsKey(search: string) {
  return ["external-circuits", search.trim()] as const;
}

export function externalCircuitDetailKey(id: string) {
  return ["external-circuits", "detail", id] as const;
}

export function useExternalCircuits(search: string) {
  return useQuery({
    queryKey: externalCircuitsKey(search),
    queryFn: () => listExternalCircuits(search),
  });
}

export function useExternalCircuitDetail(id: string | null) {
  return useQuery({
    queryKey: externalCircuitDetailKey(id ?? ""),
    queryFn: () => getExternalCircuitDetail(id as string),
    enabled: typeof id === "string" && id.length > 0,
  });
}
