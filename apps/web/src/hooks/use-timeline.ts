"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyChampionChange,
  getChampionDetail,
  getChampions,
  getDivergence,
  getTimelineEvent,
  listTimeline,
  previewChampionChange,
  type ChampionChangeRequest,
  type TimelineListFilters,
} from "@/lib/timeline";

export function timelineQueryKey(filters: TimelineListFilters) {
  return ["timeline", filters] as const;
}

export function useTimeline(filters: TimelineListFilters) {
  return useQuery({
    queryKey: timelineQueryKey(filters),
    queryFn: () => listTimeline(filters),
  });
}

export function useTimelineEvent(eventId: string | null) {
  return useQuery({
    queryKey: ["timeline", "event", eventId],
    queryFn: () => getTimelineEvent(eventId as string),
    enabled: Boolean(eventId),
  });
}

export function useDivergence(seasonId: string | null) {
  return useQuery({
    queryKey: ["timeline", "divergence", seasonId],
    queryFn: () => getDivergence(seasonId as string),
    enabled: Boolean(seasonId),
  });
}

export const championsKey = ["timeline", "champions"] as const;

export function useChampions() {
  return useQuery({
    queryKey: championsKey,
    queryFn: getChampions,
  });
}

export function useChampionDetail(seasonId: string | null) {
  return useQuery({
    queryKey: ["timeline", "champions", seasonId],
    queryFn: () => getChampionDetail(seasonId as string),
    enabled: Boolean(seasonId),
  });
}

export function usePreviewChampionChange() {
  return useMutation({
    mutationFn: (vars: { seasonId: string; request: ChampionChangeRequest }) =>
      previewChampionChange(vars.seasonId, vars.request),
  });
}

export function useApplyChampionChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      seasonId: string;
      request: ChampionChangeRequest & { previewToken: string };
    }) => applyChampionChange(vars.seasonId, vars.request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
}
