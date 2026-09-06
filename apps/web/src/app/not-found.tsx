"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useSession } from "@/providers/session-provider";

export default function NotFound() {
  const router = useRouter();
  const { isPending, isAuthenticated } = useSession();

  useEffect(() => {
    if (isPending) return;
    router.replace(isAuthenticated ? "/app" : "/login");
  }, [isPending, isAuthenticated, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </main>
  );
}