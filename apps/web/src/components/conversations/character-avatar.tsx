"use client";

import { Users } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const AVATAR_SIZES = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-sm",
  lg: "h-11 w-11 text-base",
} as const;

type CharacterAvatarProps = {
  name: string;
  imageUrl: string | null;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
};

export function CharacterAvatar({
  name,
  imageUrl,
  size = "md",
  className,
}: CharacterAvatarProps) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={cn(
          "shrink-0 rounded-full bg-muted object-cover",
          AVATAR_SIZES[size],
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-muted font-bold uppercase text-muted-foreground",
        AVATAR_SIZES[size],
        className,
      )}
    >
      {name.trim().charAt(0) || "?"}
    </span>
  );
}

export function GroupAvatar({
  size = "md",
  className,
}: {
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand",
        AVATAR_SIZES[size],
        className,
      )}
    >
      <Users className="h-1/2 w-1/2" />
    </span>
  );
}