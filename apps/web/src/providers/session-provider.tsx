"use client";

import type { Session, User } from "better-auth";
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import { authClient } from "@/lib/auth-client";

export type SessionUser = User & { role?: "USER" | "ADMIN" | string };

type SessionData = {
  session: Session | null;
  user: SessionUser | null;
};

type SessionContextValue = {
  data: SessionData;
  isPending: boolean;
  error: Error | null;
  isAuthenticated: boolean;
  refresh: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, isPending, error, refetch } = authClient.useSession();

  const value = useMemo<SessionContextValue>(
    () => ({
      data: {
        session: data?.session ?? null,
        user: data?.user ?? null,
      },
      isPending,
      error: error ?? null,
      isAuthenticated: Boolean(data?.session && data?.user),
      refresh: refetch,
    }),
    [data, isPending, error, refetch]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return ctx;
}
