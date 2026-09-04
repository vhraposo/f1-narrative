"use client";

import { CalendarDays, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Season } from "@/lib/championship";

type SeasonCardProps = {
  season: Season;
  active: boolean;
  onSelect: (season: Season) => void;
  onEdit: (season: Season) => void;
  onRemove: (season: Season) => void;
  isRemoving: boolean;
  removeError: string | null;
};

export function SeasonCard({
  season,
  active,
  onSelect,
  onEdit,
  onRemove,
  isRemoving,
  removeError,
}: SeasonCardProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Card
      className={
        active
          ? "cursor-pointer border-primary"
          : "cursor-pointer hover:border-muted-foreground/40"
      }
    >
      <button
        type="button"
        onClick={() => onSelect(season)}
        className="w-full text-left"
      >
        <CardHeader className="gap-1.5">
          <CardTitle className="text-xl">
            {season.name ?? `Temporada ${season.year}`}
          </CardTitle>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              {season.year}
            </span>
            <span
              className={
                season.status === "ACTIVE"
                  ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                  : "rounded-full bg-muted px-2 py-0.5 text-xs"
              }
            >
              {season.status}
            </span>
          </div>
        </CardHeader>
      </button>
      <CardFooter className="gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(season)}
        >
          Editar
        </Button>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Remover?</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={isRemoving}
              onClick={() => onRemove(season)}
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
