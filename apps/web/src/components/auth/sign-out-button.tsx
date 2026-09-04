"use client";

import { Loader2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { useSession } from "@/providers/session-provider";

export function SignOutButton() {
  const router = useRouter();
  const { refresh } = useSession();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setError(null);
    setIsPending(true);
    try {
      const { error: signOutError } = await authClient.signOut();
      if (signOutError) {
        setError(authErrorMessage(signOutError));
        return;
      }
      await refresh();
      router.push("/login");
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-sm text-destructive">{error}</span>}
      <Button
        variant="outline"
        size="sm"
        onClick={handleSignOut}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <LogOut className="mr-2 h-4 w-4" />
        )}
        Sair
      </Button>
    </div>
  );
}
