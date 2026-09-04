"use client";

import { Loader2, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Team } from "@/lib/teams";

type TeamCardProps = {
  team: Team;
  onEdit: (team: Team) => void;
  onRemove: (team: Team) => void;
  isRemoving: boolean;
  removeError: string | null;
};

export function TeamCard({
  team,
  onEdit,
  onRemove,
  isRemoving,
  removeError,
}: TeamCardProps) {
  const [confirming, setConfirming] = useState(false);
  const hasColor = Boolean(team.color);

  return (
    <Card>
      <CardHeader className="gap-1.5">
        <div className="flex items-center gap-3">
          {hasColor ? (
            <span
              aria-hidden
              className="h-4 w-4 shrink-0 rounded-full border"
              style={{ backgroundColor: team.color as string }}
            />
          ) : (
            <span
              aria-hidden
              className="h-4 w-4 shrink-0 rounded-full border border-dashed"
            />
          )}
          <CardTitle className="text-xl">{team.name}</CardTitle>
        </div>
        {team.shortName && (
          <p className="text-sm text-muted-foreground">{team.shortName}</p>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {team.color ? (
            <>
              Cor: <span className="font-medium">{team.color}</span>
            </>
          ) : (
            "Sem cor definida"
          )}
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(team)}
        >
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
              onClick={() => onRemove(team)}
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
              onClick={() => {
                setConfirming(false);
              }}
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
