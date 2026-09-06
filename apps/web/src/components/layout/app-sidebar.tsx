"use client";

import { AppBrand } from "@/components/layout/app-brand";
import { NAV_GROUPS } from "@/components/layout/nav-groups";
import { NavLink } from "@/components/layout/nav-link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export function AppSidebar({ userName }: { userName: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-border bg-background lg:flex">
      <div className="flex h-16 items-center border-b border-border px-6">
        <AppBrand />
      </div>
      <nav
        className="flex-1 space-y-6 overflow-y-auto px-4 py-6"
        aria-label="Navegação principal"
      >
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="space-y-4 border-t border-border px-4 py-4">
        <div className="flex items-center justify-between gap-3 px-1">
          <span className="truncate text-sm font-medium text-foreground">
            {userName}
          </span>
          <ThemeToggle />
        </div>
        <div className="px-1">
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}