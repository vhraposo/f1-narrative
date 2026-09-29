import { get } from "./api";

export type NewsSeasonContext = { id: string; year: number };

export type NewsRaceContext = {
  id: string;
  name: string;
  round: number | null;
};

export type NewsContext = {
  season: NewsSeasonContext | null;
  race: NewsRaceContext | null;
};

export type NewsFeedItem = {
  id: string;
  eventId: string | null;
  title: string;
  body: string | null;
  source: string;
  worldDate: string | null;
  createdAt: string;
  context: NewsContext;
};

export type NewsFeedResult = {
  news: NewsFeedItem[];
  context: NewsContext;
  hasMore: boolean;
  nextOffset: number | null;
};

export type NewsFilters = {
  seasonId?: string;
  raceId?: string;
  limit?: number;
  offset?: number;
};

export function listNews(filters: NewsFilters = {}): Promise<NewsFeedResult> {
  const params = new URLSearchParams();
  if (filters.seasonId) params.set("seasonId", filters.seasonId);
  if (filters.raceId) params.set("raceId", filters.raceId);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  if (filters.offset != null) params.set("offset", String(filters.offset));
  const query = params.toString();
  return get<NewsFeedResult>(`/api/news${query ? `?${query}` : ""}`);
}

export function formatNewsDate(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}
