import { cn } from "@/lib/utils";

type CountryFlagProps = {
  iso: string;
  label: string;
  className?: string;
};

export function CountryFlag({ iso, label, className }: CountryFlagProps) {
  const chars = iso
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
  return (
    <span role="img" aria-label={label} className={cn("text-[0.8em] leading-none align-middle", className)}>
      {chars}
    </span>
  );
}