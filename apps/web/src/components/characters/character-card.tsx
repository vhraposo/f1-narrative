"use client";

import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Character } from "@/lib/characters";

type CharacterCardProps = {
  character: Character;
  onDelete: (character: Character) => void;
  isDeleting: boolean;
};

export function CharacterCard({
  character,
  onDelete,
  isDeleting,
}: CharacterCardProps) {
  const [confirming, setConfirming] = useState(false);

  const birthDate = new Date(character.birthDate);
  const birthLabel = Number.isNaN(birthDate.getTime())
    ? character.birthDate
    : birthDate.toLocaleDateString("pt-BR");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{character.name}</CardTitle>
        <CardDescription>
          {character.nationality}
          {character.gender ? ` · ${character.gender}` : ""}
          {character.birthDate ? ` · Nascido(a): ${birthLabel}` : ""}
        </CardDescription>
      </CardHeader>
      {character.biography && (
        <CardContent>
          <p className="line-clamp-3 text-sm text-muted-foreground">
            {character.biography}
          </p>
        </CardContent>
      )}
      <CardFooter className="justify-end gap-2">
        <Link
          href={`/app/characters/${character.id}/edit`}
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
        title="Excluir personagem"
        description={`Deseja excluir "${character.name}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => onDelete(character)}
        isPending={isDeleting}
      />
    </Card>
  );
}
