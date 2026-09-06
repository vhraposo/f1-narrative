"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useSession } from "@/providers/session-provider";

export function GuestGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isPending, isAuthenticated } = useSession();

  useEffect(() => {
    if (!isPending && isAuthenticated) {
      router.replace("/app");
    }
  }, [isPending, isAuthenticated, router]);

  // Mesmo padrao do guard privado: splash enquanto pendente ou durante o
  // redirect; children so sao renderizados com autenticado=false.
  if (isPending || isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return <>{children}</>;
}