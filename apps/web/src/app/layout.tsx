import type { Metadata } from "next";

import { Providers } from "@/providers/providers";
import { THEME_STORAGE_KEY, ThemeProvider } from "@/providers/theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "F1 Narrative Universe",
    template: "%s | F1 Narrative Universe",
  },
  description: "Um universo narrativo da Fórmula 1",
};

function applyInitialThemeScript(): string {
  return `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})();`;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <script dangerouslySetInnerHTML={{ __html: applyInitialThemeScript() }} />
        <ThemeProvider>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
