import { cn } from "@/lib/utils";
import { flagUrlForIso } from "@/lib/nationalities";

type CountryFlagProps = {
  iso: string;
  label: string;
  className?: string;
};

export function CountryFlag({ iso, label, className }: CountryFlagProps) {
  return (
    <img
      src={flagUrlForIso(iso)}
      alt={label}
      width={20}
      height={14}
      className={cn("h-3.5 w-5 rounded-[2px] object-cover shadow-sm", className)}
    />
  );
}
