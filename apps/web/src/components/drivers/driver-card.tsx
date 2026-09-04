"use client";

import { Loader2, Pencil, Trash2 } from "lucide-react";
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
import type { Driver } from "@/lib/driver-profiles";

type DriverCardProps = {
  driver: Driver;
  onRemove: (driver: Driver) => void;
  isRemoving: boolean;
};

export function DriverCard({ driver, onRemove, isRemoving }: DriverCardProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-4 space-y-0">
        {driver.character.imageUrl ? (
          <img
            src={driver.character.imageUrl}
            alt={driver.character.name}
            className="h-14 w-14 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-lg font-bold">
            {driver.character.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <CardTitle className="text-xl">
            <Link
              href={`/app/characters/${driver.characterId}`}
              className="transition-colors hover:text-primary"
            >
              {driver.character.name}
            </Link>
          </CardTitle>
          {driver.character.nationality && (
            <CardDescription>
              {driver.character.nationality}
            </CardDescription>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Número do piloto:</p>
        <p className="text-3xl font-bold">
          {driver.number != null ? driver.number : "—"}
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Link
          href={`/app/characters/${driver.characterId}`}
          className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Pencil className="mr-2 h-4 w-4" />
          Editar
        </Link>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Remover?</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={isRemoving}
              onClick={() => onRemove(driver)}
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
    </Card>
  );
}
