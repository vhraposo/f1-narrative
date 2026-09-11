import {
  Database,
  Flag,
  HeartHandshake,
  MessagesSquare,
  Newspaper,
  Rocket,
  Shield,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItemDef = {
  href: string;
  label: string;
  Icon: LucideIcon;
};

export type NavGroupDef = {
  label: string;
  items: NavItemDef[];
};

export const NAV_GROUPS: NavGroupDef[] = [
  {
    label: "Universo",
    items: [
      { href: "/app/characters", label: "Personagens", Icon: Users },
      { href: "/app/drivers", label: "Pilotos", Icon: Flag },
      { href: "/app/teams", label: "Equipes", Icon: Shield },
      {
        href: "/app/relationships",
        label: "Relacionamentos",
        Icon: HeartHandshake,
      },
      { href: "/app/player-entry", label: "Entrar na F1", Icon: Rocket },
    ],
  },
  {
    label: "Temporada",
    items: [
      { href: "/app/championship", label: "Campeonato", Icon: Trophy },
      { href: "/app/events", label: "Eventos", Icon: Newspaper },
    ],
  },
  {
    label: "Narrativa",
    items: [
      {
        href: "/app/conversations",
        label: "Conversas",
        Icon: MessagesSquare,
      },
    ],
  },
  {
    label: "Externo",
    items: [
      {
        href: "/app/external",
        label: "F1 World Data",
        Icon: Database,
      },
    ],
  },
];