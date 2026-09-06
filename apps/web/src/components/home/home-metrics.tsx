import { Flag, Newspaper, Shield, Users, type LucideIcon } from "lucide-react";

type Metric = {
  label: string;
  hint: string;
  Icon: LucideIcon;
  value: number | undefined;
};

export function HomeMetrics({
  counts,
}: {
  counts: {
    characters?: number;
    drivers?: number;
    teams?: number;
    events?: number;
  };
}) {
  const metrics: Metric[] = [
    {
      label: "Personagens",
      hint: "no seu universo",
      Icon: Users,
      value: counts.characters,
    },
    {
      label: "Pilotos",
      hint: "na grade",
      Icon: Flag,
      value: counts.drivers,
    },
    {
      label: "Equipes",
      hint: "no paddock",
      Icon: Shield,
      value: counts.teams,
    },
    {
      label: "Eventos",
      hint: "registrados",
      Icon: Newspaper,
      value: counts.events,
    },
  ];

  return (
    <section aria-label="Panorama do universo">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(({ label, hint, Icon, value }) => (
          <div
            key={label}
            className="rounded-md border border-border bg-card p-5"
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-brand" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {label}
              </span>
            </div>
            <p className="mt-3 text-4xl font-black tabular-nums tracking-tight text-foreground">
              {value === undefined ? "–" : value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
        ))}
      </div>
    </section>
  );
}