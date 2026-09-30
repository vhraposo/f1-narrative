"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getDivergence,
  getTimelineEvent,
  listTimeline,
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
