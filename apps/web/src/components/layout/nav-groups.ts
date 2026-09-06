import {
  Flag,
  HeartHandshake,
  MessagesSquare,
  Newspaper,
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
];