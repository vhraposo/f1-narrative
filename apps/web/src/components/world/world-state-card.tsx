import { CalendarDays } from "lucide-react";

import { useRaces, useSeasons } from "@/hooks/use-championship";
import { useWorld } from "@/hooks/use-world";
import { RACE_SESSION_LABELS } from "@/lib/world";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function WorldStateCard() {
  const { data: world, isLoading } = useWorld();
  const { data: seasons } = useSeasons();
  const season = seasons?.find((s) => s.id === world?.currentSeasonId);
  const { data: races } = useRaces(season?.id ?? "");
  const race = races?.find((r) => r.id === world?.currentRaceId);

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        Carregando o estado do mundo…
      </p>
    );
  }

  if (!world) {
    return null;
  }

  const rows = [
    { label: "Data atual", value: formatDate(world.currentDate) },
    {
      label: "Temporada",
      value: season ? (season.name ?? `Temporada ${season.year}`) : "—",
    },
    { label: "Corrida", value: race?.name ?? "—" },
    {
      label: "Sessão",
      value: world.currentSession
        ? RACE_SESSION_LABELS[world.currentSession]
        : "—",
    },
  ];

  return (
    <dl className="divide-y divide-border">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0"
        >
          <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {row.label}
          </dt>
          <dd className="text-right text-sm font-semibold text-foreground">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}