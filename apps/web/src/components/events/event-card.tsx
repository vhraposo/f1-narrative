"use client";

import { Calendar, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  EVENT_IMPORTANCE_LABELS,
  EVENT_SOURCE_LABELS,
  EVENT_TYPE_LABELS,
} from "@/lib/events";
import type { Event } from "@/lib/events";

type EventCardProps = {
  event: Event;
  isDeleting: boolean;
  onDelete: (event: Event) => void;
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function EventCard({ event, isDeleting, onDelete }: EventCardProps) {
  const [confirming, setConfirming] = useState(false);
  const dateLabel = formatDate(event.worldDate);

  return (
    <Card>
      <CardHeader className="gap-1.5">
        <Link
          href={`/app/events/${event.id}`}
          className="font-semibold text-foreground transition-colors hover:text-primary"
        >
          <CardTitle className="text-lg">{event.title}</CardTitle>
        </Link>
        <CardDescription>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
            {EVENT_TYPE_LABELS[event.type]}
          </span>{" "}
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
            {EVENT_IMPORTANCE_LABELS[event.importance]}
          </span>{" "}
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
            {EVENT_SOURCE_LABELS[event.source]}
          </span>
        </CardDescription>
        {dateLabel && (
          <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            {dateLabel}
          </p>
        )}
      </CardHeader>
      <CardFooter className="justify-end gap-2">
        <Link
          href={`/app/events/${event.id}/edit`}
          className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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