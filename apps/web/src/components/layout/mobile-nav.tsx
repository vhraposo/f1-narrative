"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { AppBrand } from "@/components/layout/app-brand";
import { NAV_GROUPS } from "@/components/layout/nav-groups";
import { NavLink } from "@/components/layout/nav-link";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

export function MobileNav({ userName }: { userName: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:hidden">
        <AppBrand />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Abrir menu de navegação"
            aria-expanded={open}
            className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-input text-muted-foreground transition-colors motion-safe:transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-[visibility,opacity] motion-safe:transition-[visibility,opacity] lg:hidden",
          open ? "visible opacity-100" : "invisible opacity-0",
        )}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navegação"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-xs flex-col border-l border-border bg-background transition-[transform,visibility] motion-safe:transition-[transform,visibility] lg:hidden",
          open ? "visible translate-x-0" : "invisible translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          <AppBrand />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu de navegação"
            className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-input text-muted-foreground transition-colors motion-safe:transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
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
                    <NavLink item={item} onSelect={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="space-y-4 border-t border-border px-4 py-4">
          <p className="truncate px-1 text-sm font-medium text-foreground">
            {userName}
          </p>
          <div className="px-1">
            <SignOutButton />
          </div>
        </div>
      </div>
    </>
  );
}