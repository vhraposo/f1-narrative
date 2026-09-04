"use client";

import { Calendar, FileText } from "lucide-react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EVENT_SOURCE_LABELS } from "@/lib/events";
import type { NewsItem } from "@/lib/events";

type NewsCardProps = {
  news: NewsItem;
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// NewsItem é derivada e SOMENTE LEITURA: não há ações de editar/criar/excluir.
export function NewsCard({ news }: NewsCardProps) {
  const dateLabel = formatDate(news.worldDate);
  const createdAt = new Date(news.createdAt).toLocaleString("pt-BR");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          Notícia gerada
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <h3 className="text-lg font-semibold tracking-tight">{news.title}</h3>
        <p className="whitespace-pre-line text-sm text-muted-foreground">
          {news.body}
        </p>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{EVENT_SOURCE_LABELS[news.source]}</span>
        {dateLabel && (
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {dateLabel}
          </span>
        )}
        <span>Gerada em: {createdAt}</span>
      </CardFooter>
    </Card>
  );
}