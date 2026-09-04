"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSchedule,
  deleteSchedule,
  listSchedule,
  updateSchedule,
  type CreateScheduleInput,
  type Schedule,
  type UpdateScheduleInput,
} from "@/lib/schedule";

export function scheduleKey(characterId: string) {
  return ["schedule", characterId] as const;
}

export function useSchedule(characterId: string | undefined) {
  return useQuery({
    queryKey: scheduleKey(characterId ?? ""),
    queryFn: () => listSchedule(characterId as string),
    enabled: Boolean(characterId),
  });
}

function useInvalidateSchedule(characterId: string) {
  const queryClient = useQueryClient();
  return () =>
    void queryClient.invalidateQueries({ queryKey: scheduleKey(characterId) });
}

export function useCreateSchedule(characterId: string) {
  const invalidate = useInvalidateSchedule(characterId);
  return useMutation({
    mutationFn: (input: CreateScheduleInput) => createSchedule(characterId, input),
    onSuccess: invalidate,
  });
}

export function useUpdateSchedule(characterId: string) {
  const invalidate = useInvalidateSchedule(characterId);
  return useMutation({
    mutationFn: (vars: { scheduleId: string; input: UpdateScheduleInput }) =>
      updateSchedule(characterId, vars.scheduleId, vars.input),
    onSuccess: invalidate,
  });
}

export function useDeleteSchedule(characterId: string) {
  const invalidate = useInvalidateSchedule(characterId);
  return useMutation({
    mutationFn: (scheduleId: string) => deleteSchedule(characterId, scheduleId),
    onSuccess: invalidate,
  });
}

export type { Schedule };