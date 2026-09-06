"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavItemDef } from "@/components/layout/nav-groups";
import { cn } from "@/lib/utils";

export function isLinkActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLink({
  item,
  onSelect,
}: {
  item: NavItemDef;
  onSelect?: () => void;
}) {
  const pathname = usePathname();
  const active = isLinkActive(pathname, item.href);
  const Icon = item.Icon;

  return (
    <Link
      href={item.href}
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium transition-colors motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        active
          ? "bg-accent font-semibold text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {active && (
        <span
          className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-brand"
          aria-hidden="true"
        />
      )}
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors motion-safe:transition-colors",
          active
            ? "text-brand"
            : "text-muted-foreground group-hover:text-foreground",
        )}
        aria-hidden="true"
      />
      {item.label}
      {active && (
        <span
          className="ml-auto h-1.5 w-1.5 rounded-full bg-brand"
          aria-hidden="true"
        />
      )}
    </Link>
  );
}