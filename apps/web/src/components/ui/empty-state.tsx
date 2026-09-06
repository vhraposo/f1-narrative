import * as React from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: React.ReactNode;
  kicker?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  kicker,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-4 py-10 text-center sm:py-14",
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      ) : (
        <span aria-hidden className="mb-4 h-1 w-8 rounded-full bg-brand" />
      )}
      {kicker && (
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {kicker}
        </p>
      )}
      <h2 className="mt-1 text-xl font-black tracking-tight text-foreground sm:text-2xl">
        {title}
      </h2>
      {description && (
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground sm:text-base">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}