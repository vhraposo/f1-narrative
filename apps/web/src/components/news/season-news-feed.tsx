"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";

import { SectionHeading } from "@/components/home/section-heading";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useNews } from "@/hooks/use-news";
import { formatNewsDate, type NewsFeedItem } from "@/lib/news";

function contextLabel(item: NewsFeedItem): string {
  if (item.context.race) {
    const round =
      item.context.race.round != null ? `R${item.context.race.round}` : "Corrida";
    return `${round} · ${item.context.race.name}`;
  }
  if (item.context.season) {
    return `Temporada ${item.context.season.year}`;
  }
  return "Notícia";
}

export function SeasonNewsFeed({
  seasonId,
  kicker = "Imprensa",
  title = "Notícias da temporada",
  limit = 6,
  emptyTitle = "Sem notícias nesta temporada.",
  emptyDescription = "As notícias aparecem quando os eventos da temporada gerarem cobertura.",
}: {
  seasonId: string | null;
  kicker?: string;
  title?: string;
  limit?: number;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const { data, isLoading, isError, error, refetch, isRefetching } = useNews({
    seasonId: seasonId ?? undefined,
    limit,
  });

  return (
    <section aria-label={title} className="space-y-1">
      <SectionHeading kicker={kicker} title={title} />

      {!seasonId ? (
        <div className="mt-5">
          <EmptyState
            title="Sem temporada ativa."
            description="Selecione ou crie uma temporada para acompanhar a cobertura jornalística."
          />
        </div>
      ) : null}

      {seasonId && isLoading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando notícias…
        </div>
      ) : null}

      {seasonId && isError ? (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-destructive">
            Não foi possível carregar as notícias.
            {error instanceof Error ? ` ${error.message}` : ""}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isRefetching}
            onClick={() => void refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : null}

      {seasonId && data && data.news.length === 0 ? (
        <div className="mt-5">
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      ) : null}

      {seasonId && data && data.news.length > 0 ? (
        <>
          <ul className="mt-5 divide-y divide-border rounded-md border border-border bg-card">
            {data.news.map((item) => (
              <li key={item.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {contextLabel(item)}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {formatNewsDate(item.worldDate ?? item.createdAt)}
                  </span>
                </div>
                {item.eventId ? (
                  <Link
                    href={`/app/events/${item.eventId}`}
                    className="mt-1 block font-medium text-foreground hover:text-brand"
                  >
                    {item.title}
                  </Link>
                ) : (
                  <p className="mt-1 font-medium text-foreground">
                    {item.title}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {data.hasMore ? (
            <p className="text-xs text-muted-foreground">
              Mostrando {data.news.length} notícias desta temporada.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
