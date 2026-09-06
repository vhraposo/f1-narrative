import { Flag } from "lucide-react";
import Link from "next/link";

export function AppBrand() {
  return (
    <Link
      href="/app"
      className="group inline-flex items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <Flag className="h-5 w-5 text-brand" aria-hidden="true" />
      <span className="text-sm font-black uppercase tracking-[0.18em] text-foreground">
        F1<span className="text-brand">NW</span>
      </span>
    </Link>
  );
}