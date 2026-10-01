"use client";

import { useQuery } from "@tanstack/react-query";

import {
  listNews,
  type NewsFeedResult,
  type NewsFilters,
} from "@/lib/news";

export const newsKey = ["news"] as const;

export function newsFeedKey(filters: NewsFilters) {
  return ["news", filters] as const;
}

export function useNews(filters: NewsFilters) {
  return useQuery<NewsFeedResult>({
    queryKey: newsFeedKey(filters),
    queryFn: () => listNews(filters),
    enabled: Boolean(filters.seasonId || filters.raceId),
    staleTime: 30_000,
  });
}
