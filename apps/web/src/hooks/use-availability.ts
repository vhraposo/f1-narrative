"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAvailability,
  updateAvailability,
  type Availability,
  type UpdateAvailabilityInput,
} from "@/lib/availability";

export function availabilityKey(characterId: string) {
  return ["availability", characterId] as const;
}

export function useAvailability(characterId: string | undefined) {
  return useQuery({
    queryKey: availabilityKey(characterId ?? ""),
    queryFn: () => getAvailability(characterId as string),
    enabled: Boolean(characterId),
  });
}

export function useUpdateAvailability(characterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAvailabilityInput) =>
      updateAvailability(characterId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: availabilityKey(characterId),
      });
    },
  });
}

export type { Availability };