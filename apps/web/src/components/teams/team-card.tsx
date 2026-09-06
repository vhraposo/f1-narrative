"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Remover
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Remover equipe"
        description={`Deseja remover "${team.name}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => onRemove(team)}
        isPending={isRemoving}
        error={removeError}
      />
      {removeError && (
        <p className="px-6 pb-4 text-sm text-destructive" role="alert">
          {removeError}
        </p>
      )}
    </Card>
  );
}
