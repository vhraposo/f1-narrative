import * as React from "react";

import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  detail?: React.ReactNode;
  action?: React.ReactNode;
  role?: string;
  heading?: "h1" | "h2";
  className?: string;
};

export function ErrorState({
  title,
  description,
  detail,
  action,
  role,
  heading = "h2",
  className,
}: ErrorStateProps) {
  const HeadingTag = heading;
  return (
    <div
      className={cn(
        "flex flex-col items-center px-4 py-10 text-center sm:py-14",
        className,
      )}
      role={role}
    >
      <span aria-hidden className="mb-4 h-1 w-8 rounded-full bg-destructive" />
      <HeadingTag className="text-xl font-black tracking-tight text-foreground sm:text-2xl">
        {title}
      </HeadingTag>
      {description && (
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground sm:text-base">
          {description}
        </p>
      )}
      {detail && (
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{detail}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}