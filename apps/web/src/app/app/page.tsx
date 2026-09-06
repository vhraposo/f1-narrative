"use client";

import { HomeFeed } from "@/components/home/home-feed";
import { HomeMetrics } from "@/components/home/home-metrics";
import { HomeRaceWeekend } from "@/components/home/home-race-weekend";
import { HomeTiles } from "@/components/home/home-tiles";
import { SectionHeading } from "@/components/home/section-heading";
import { WorldStateCard } from "@/components/world/world-state-card";
import { useCharacters } from "@/hooks/use-characters";
import { useSeasons } from "@/hooks/use-championship";
import { useDrivers } from "@/hooks/use-driver-profiles";
import { useEvents } from "@/hooks/use-events";
import { useRelationships } from "@/hooks/use-relationships";
import { useTeams } from "@/hooks/use-teams";
import { useSession } from "@/providers/session-provider";

export default function AppPage() {
  const { data } = useSession();
  const { data: characters } = useCharacters();
  const { data: drivers } = useDrivers();
  const { data: teams } = useTeams();
  const { data: relationships } = useRelationships();
  const { data: seasons } = useSeasons();
  const { data: events } = useEvents();

  const counts = {
    characters: characters?.length,
    drivers: drivers?.length,
    teams: teams?.length,
    relationships: relationships?.length,
    seasons: seasons?.length,
    events: events?.length,
  };

  return (
    <div className="space-y-14">
      <section aria-label="Boas-vindas" className="py-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
          Central de operações
        </p>
        <h1 className="mt-2 max-w-3xl text-4xl font-black tracking-tight text-foreground sm:text-5xl">
          Olá, {data.user?.name ?? "piloto"}
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          O controle da sua temporada de Fórmula 1: acompanhe o estado do
          mundo, o próximo fim de semana e os eventos que movem a história.
        </p>
      </section>

      <HomeMetrics counts={counts} />

      <HomeRaceWeekend />

      <HomeTiles counts={counts} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <HomeFeed />
        <section aria-label="Estado do mundo">
          <SectionHeading kicker="Agora" title="Estado do mundo" />
          <div className="mt-5 rounded-md border border-border bg-card p-5">
            <WorldStateCard />
          </div>
        </section>
      </div>
    </div>
  );
}