"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useSession } from "@/providers/session-provider";

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isPending, isAuthenticated, data } = useSession();

  useEffect(() => {
    if (!isPending && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isPending, isAuthenticated, router]);

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  // Sempre renderiza marcacao nao-vazia (splash) para que a rota seja
  // mantida na pre-renderizacao estatica; o redirect para /login ocorre
  // via useEffect no cliente quando nao ha sessao.
  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/app" className="text-sm font-semibold text-muted-foreground">
              F1 Narrative Universe
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/app/characters"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Personagens
              </Link>
              <Link
                href="/app/drivers"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Pilotos
              </Link>
              <Link
                href="/app/teams"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Equipes
              </Link>
              <Link
                href="/app/relationships"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Relacionamentos
              </Link>
              <Link
                href="/app/championship"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Campeonato
              </Link>
              <Link
                href="/app/events"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Eventos
              </Link>
              <Link
                href="/app/conversations"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Conversas
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <span className="text-sm text-muted-foreground">
              {data.user?.name}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="container flex-1 py-8">{children}</main>
    </div>
  );
}
