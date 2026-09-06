import type { Metadata } from "next";
import type { ReactNode } from "react";

import { GuestGuard } from "@/components/auth/guest-guard";

export const metadata: Metadata = {
  title: "Entrar",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <GuestGuard>{children}</GuestGuard>
      </div>
    </main>
  );
}
