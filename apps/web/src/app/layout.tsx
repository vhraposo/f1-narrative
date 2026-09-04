import type { Metadata } from "next";

import { Providers } from "@/providers/providers";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "F1 Narrative Universe",
    template: "%s | F1 Narrative Universe",
  },
  description: "Um universo narrativo da Fórmula 1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
