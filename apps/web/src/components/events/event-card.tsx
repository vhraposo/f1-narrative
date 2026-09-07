"use client";

import { ArrowUpRight, CalendarDays, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ImportanceDot, IMPORTANCE_SIGNAL_CLASS } from "@/components/events/event-display";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatWorldDate } from "@/lib/event-format";
import {
  EVENT_IMPORTANCE_LABELS,
  EVENT_SOURCE_LABELS,
  EVENT_TYPE_LABELS,
} from "@/lib/events";
import type { Event } from "@/lib/events";
import { cn } from "@/lib/utils";

type EventCardProps = {
  event: Event;
  isDeleting: boolean;
  onDelete: (event: Event) => void;
};

export function EventCard({ event, isDeleting, onDelete }: EventCardProps) {
  const [confirming, setConfirming] = useState(false);
  const dateLabel = formatWorldDate(event.worldDate);

  return (
    <Card className="relative flex h-full flex-col overflow-hidden group">
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-[3px] transition-colors group-hover:brightness-110",
          IMPORTANCE_SIGNAL_CLASS[event.importance],
        )}
      />
      <CardContent className="flex flex-1 flex-col pt-5">
        <Link
          href={`/app/events/${event.id}`}
          className="flex h-full flex-col focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="flex items-center gap-2">
            <ImportanceDot importance={event.importance} />
            <span className="truncate text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {EVENT_TYPE_LABELS[event.type]}
            </span>
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
            <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {EVENT_IMPORTANCE_LABELS[event.importance]}
            </span>
            <ArrowUpRight
              className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-brand"
              aria-hidden="true"
            />
          </span>
          <CardTitle className="mt-3 text-lg leading-snug tracking-tight text-foreground transition-colors group-hover:text-brand">
            {event.title}
          </CardTitle>
          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {dateLabel && (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {dateLabel}
              </span>
            )}
            <span className="truncate">
              {EVENT_SOURCE_LABELS[event.source]}
            </span>
          </span>
        </Link>
      </CardContent>
      <CardFooter className="gap-2 pt-2">
        <Link
          href={`/app/events/${event.id}/edit`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          <Pencil className="mr-2 h-4 w-4" />
          Editar
        </Link>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Excluir
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Excluir evento"
        description={`Deseja excluir "${event.title}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => onDelete(event)}
        isPending={isDeleting}
      />
    </Card>
  );
}