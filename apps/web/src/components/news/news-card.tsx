"use client";

import { Calendar, Newspaper } from "lucide-react";

import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { formatWorldDate } from "@/lib/event-format";
import { EVENT_SOURCE_LABELS } from "@/lib/events";
import type { NewsItem } from "@/lib/events";

type NewsCardProps = {
  news: NewsItem;
};

// NewsItem é derivada e SOMENTE LEITURA: não há ações de editar/criar/excluir.
export function NewsCard({ news }: NewsCardProps) {
  const dateLabel = formatWorldDate(news.worldDate);

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
          <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
          {EVENT_SOURCE_LABELS[news.source]}
        </p>
        <h3 className="text-2xl font-black tracking-tight text-foreground">
          {news.title}
        </h3>
        <p className="whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground">
          {news.body}
        </p>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {dateLabel && (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            {dateLabel}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}