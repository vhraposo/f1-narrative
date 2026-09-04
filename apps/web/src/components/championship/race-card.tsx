"use client";

import { Calendar, Loader2, MapPin, Pencil, Timer, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Race } from "@/lib/championship";

type RaceCardProps = {
  race: Race;
  onEdit: (race: Race) => void;
  onRemove: (race: Race) => void;
  onViewResults: (race: Race) => void;
  isRemoving: boolean;
  removeError: string | null;
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function RaceCard({
  race,
  onEdit,
  onRemove,
  onViewResults,
  isRemoving,
  removeError,
}: RaceCardProps) {
  const [confirming, setConfirming] = useState(false);
  const dateLabel = formatDate(race.date);

  return (
    <Card>
      <CardHeader className="gap-1.5">
        <CardTitle className="text-lg">{race.name}</CardTitle>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {race.circuit && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {race.circuit}
              {race.country ? `, ${race.country}` : ""}
            </span>
          )}
          {race.round != null && (
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3.5 w-3.5" />
              Rodada {race.round}
            </span>
          )}
          {dateLabel && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {dateLabel}
            </span>
          )}
          <span
            className={
              race.status === "FINISHED"
                ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                : "rounded-full bg-muted px-2 py-0.5 text-xs"
            }
          >
            {race.status}
          </span>
        </div>
      </CardHeader>
      <CardFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={() => onViewResults(race)}>
          Resultados
        </Button>
        <Button variant="outline" size="sm" onClick={() => onEdit(race)}>
          <Pencil className="mr-2 h-4 w-4" />
          Editar
        </Button>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Remover?</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={isRemoving}
              onClick={() => onRemove(race)}
            >
              {isRemoving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Confirmar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isRemoving}
              onClick={() => setConfirming(false)}
            >
              Cancelar
            </Button>
          </div>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Remover
          </Button>
        )}
      </CardFooter>
      {removeError && (
        <p className="px-6 pb-4 text-sm text-destructive" role="alert">
          {removeError}
        </p>
      )}
    </Card>
  );
}
