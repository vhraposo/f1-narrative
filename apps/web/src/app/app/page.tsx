"use client";

import { Flag, HeartHandshake, Newspaper, Shield, Trophy, Users } from "lucide-react";
import Link from "next/link";

import { WorldStateCard } from "@/components/world/world-state-card";
import { Card, CardContent } from "@/components/ui/card";
import { useSession } from "@/providers/session-provider";

export default function AppPage() {
  const { data } = useSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Olá, {data.user?.name ?? "piloto"}
        </h1>
        <p className="text-muted-foreground">
          Bem-vindo ao seu universo narrativo da Fórmula 1.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <WorldStateCard />
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-dashed p-8">
          <Link
            href="/app/characters"
            className="group inline-flex items-center gap-3 text-xl font-semibold text-foreground transition-colors hover:text-primary"
          >
            <Users className="h-6 w-6" />
            Personagens
          </Link>
          <p className="mt-2 text-muted-foreground">
            Crie e gerencie os personagens do seu universo.
          </p>
        </div>
        <div className="rounded-lg border border-dashed p-8">
          <Link
            href="/app/drivers"
            className="group inline-flex items-center gap-3 text-xl font-semibold text-foreground transition-colors hover:text-primary"
          >
            <Flag className="h-6 w-6" />
            Pilotos
          </Link>
          <p className="mt-2 text-muted-foreground">
            Veja e gerencie os pilotos do seu universo.
          </p>
        </div>
        <div className="rounded-lg border border-dashed p-8">
          <Link
            href="/app/teams"
            className="group inline-flex items-center gap-3 text-xl font-semibold text-foreground transition-colors hover:text-primary"
          >
            <Shield className="h-6 w-6" />
            Equipes
          </Link>
          <p className="mt-2 text-muted-foreground">
            Crie e gerencie as equipes do seu universo.
          </p>
        </div>
        <div className="rounded-lg border border-dashed p-8">
          <Link
            href="/app/relationships"
            className="group inline-flex items-center gap-3 text-xl font-semibold text-foreground transition-colors hover:text-primary"
          >
            <HeartHandshake className="h-6 w-6" />
            Relacionamentos
          </Link>
          <p className="mt-2 text-muted-foreground">
            Vincule personagens e defina as dimensões da relação.
          </p>
        </div>
        <div className="rounded-lg border border-dashed p-8">
          <Link
            href="/app/championship"
            className="group inline-flex items-center gap-3 text-xl font-semibold text-foreground transition-colors hover:text-primary"
          >
            <Trophy className="h-6 w-6" />
            Campeonato
          </Link>
          <p className="mt-2 text-muted-foreground">
            Temporadas, corridas, resultados e classificação.
          </p>
        </div>
        <div className="rounded-lg border border-dashed p-8">
          <Link
            href="/app/events"
            className="group inline-flex items-center gap-3 text-xl font-semibold text-foreground transition-colors hover:text-primary"
          >
            <Newspaper className="h-6 w-6" />
            Eventos
          </Link>
          <p className="mt-2 text-muted-foreground">
            Eventos da narrativa e a notícia derivada dos participantes.
          </p>
        </div>
      </div>
    </div>
  );
}
