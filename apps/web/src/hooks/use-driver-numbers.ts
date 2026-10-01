"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDriverNumbers,
  setDriverNumber,
  type DriverNumberBoard,
} from "@/lib/driver-numbers";
import { driversKey } from "./use-driver-profiles";

export function driverNumbersKey(
  seasonId: string,
  driverProfileId?: string,
) {
  return ["driver-numbers", seasonId, driverProfileId ?? null] as const;
}

export function useDriverNumbers(
  seasonId: string | undefined,
  driverProfileId: string | undefined,
) {
  return useQuery<DriverNumberBoard>({
    queryKey: driverNumbersKey(seasonId ?? "", driverProfileId),
    queryFn: () => getDriverNumbers(seasonId as string, driverProfileId),
    enabled: Boolean(seasonId && driverProfileId),
  });
}

export function useSetDriverNumber(
  seasonId: string,
  driverProfileId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (number: number | null) =>
      setDriverNumber(seasonId, driverProfileId, number),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: driverNumbersKey(seasonId, driverProfileId),
      });
      void queryClient.invalidateQueries({ queryKey: driversKey });
    },
  });
}
