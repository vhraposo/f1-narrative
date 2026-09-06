import {
  Flag,
  HeartHandshake,
  Newspaper,
  Shield,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

import { SectionHeading } from "@/components/home/section-heading";
import { UniverseTile } from "@/components/home/universe-tile";

export type TileCounts = {
  characters?: number;
  drivers?: number;
  teams?: number;
  relationships?: number;
  seasons?: number;
  events?: number;
};

type TileDef = {
  href: string;
  kicker: string;
  title: string;
  description: string;
  Icon: LucideIcon;
  meta: string;
};

function metaText(value: number | undefined, singular: string, plural: string) {
  if (value === undefined) return "carregando…";
  return `${value} ${value === 1 ? singular : plural}`;
}

export function HomeTiles({ counts }: { counts: TileCounts }) {
  const tiles: TileDef[] = [
    {
      href: "/app/characters",
      kicker: "Origem",
      title: "Personagens",
      description: "Quem protagoniza a temporada em construção.",
      Icon: Users,
      meta: metaText(counts.characters, "personagem", "personagens"),
    },
    {
      href: "/app/drivers",
      kicker: "Grade",
      title: "Pilotos",
      description: "Perfis, números e times na pista.",
      Icon: Flag,
      meta: metaText(counts.drivers, "piloto", "pilotos"),
    },
    {
      href: "/app/teams",
      kicker: "Construtores",
      title: "Equipes",
      description: "Escuderias e a identidade de cada box.",
      Icon: Shield,
      meta: metaText(counts.teams, "equipe", "equipes"),
    },
    {
      href: "/app/relationships",
      kicker: "Vínculos",
      title: "Relacionamentos",
      description: "As dinâmicas que movem a narrativa.",
      Icon: HeartHandshake,
      meta: metaText(counts.relationships, "vínculo", "vínculos"),
    },
    {
      href: "/app/championship",
      kicker: "Pontuação",
      title: "Campeonato",
      description: "Temporadas, corridas, resultados e classificação.",
      Icon: Trophy,
      meta: metaText(counts.seasons, "temporada", "temporadas"),
    },
    {
      href: "/app/events",
      kicker: "Narrativa",
      title: "Eventos",
      description: "Acontecimentos e notícias que descrevem a história.",
      Icon: Newspaper,
      meta: metaText(counts.events, "evento", "eventos"),
    },
  ];

  return (
    <section aria-label="Explorar o universo">
      <SectionHeading
        kicker="Explorar"
        title="O paddock do seu universo"
        action={
          <span className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:inline">
            Escolha o próximo destino
          </span>
        }
      />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <UniverseTile key={tile.href} {...tile} />
        ))}
      </div>
    </section>
  );
}