"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
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

  const userName = data.user?.name ?? "Piloto";

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar userName={userName} />
      <MobileNav userName={userName} />
      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}