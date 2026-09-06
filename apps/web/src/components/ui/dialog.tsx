"use client";

import { X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DialogContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  focusReturnRef: React.RefObject<HTMLElement | null>;
  titleId: string;
  descriptionId: string;
  hasDescription: boolean;
  setHasDescription: (has: boolean) => void;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialogContext(componentName: string): DialogContextValue {
  const context = React.useContext(DialogContext);
  if (!context) {
    throw new Error(`"${componentName}" deve ser usado dentro de <Dialog>.`);
  }
  return context;
}

type DialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
};

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [hasDescription, setHasDescription] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const focusReturnRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (isControlled) {
        onOpenChange?.(next);
      } else {
        setInternalOpen(next);
      }
    },
    [isControlled, onOpenChange],
  );

  React.useEffect(() => {
    if (!isOpen) return;

    const returnTo = focusReturnRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      if (returnTo && document.contains(returnTo)) {
        returnTo.focus();
      }
    };
  }, [isOpen]);

  const contextValue = React.useMemo<DialogContextValue>(
    () => ({
      open: isOpen,
      setOpen,
      triggerRef,
      focusReturnRef,
      titleId,
      descriptionId,
      hasDescription,
      setHasDescription,
    }),
    [isOpen, setOpen, titleId, descriptionId, hasDescription],
  );

  return (
    <DialogContext.Provider value={contextValue}>
      {children}
    </DialogContext.Provider>
  );
}

type DialogTriggerProps = React.ComponentPropsWithoutRef<typeof Button>;

export const DialogTrigger = React.forwardRef<
  HTMLButtonElement,
  DialogTriggerProps
>(({ onClick, ...props }, ref) => {
  const { open, setOpen, triggerRef } = useDialogContext("DialogTrigger");

  const setRefs = React.useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref, triggerRef],
  );

  return (
    <Button
      ref={setRefs}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(event) => {
        onClick?.(event);
        setOpen(true);
      }}
      {...props}
    />
  );
});
DialogTrigger.displayName = "DialogTrigger";

type DialogContentProps = React.HTMLAttributes<HTMLDivElement> & {
  initialFocusRef?: React.RefObject<HTMLElement | null>;
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
}

export function DialogContent({
  children,
  className,
  initialFocusRef,
  ...props
}: DialogContentProps) {
  const { open, setOpen, focusReturnRef, titleId, descriptionId, hasDescription } =
    useDialogContext("DialogContent");
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    focusReturnRef.current = document.activeElement as HTMLElement | null;
  }, [open, focusReturnRef]);

  React.useEffect(() => {
    if (!open || !contentRef.current) return;
    const container = contentRef.current;
    const explicitFocus =
      initialFocusRef?.current ??
      container.querySelector<HTMLElement>("[data-dialog-autofocus]");
    const target =
      explicitFocus ?? getFocusableElements(container)[0] ?? container;
    target.focus();
  }, [open, initialFocusRef]);

  React.useEffect(() => {
    if (!open) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, setOpen]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const container = contentRef.current;
    if (!container) return;
    const focusables = getFocusableElements(container);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-6">
      <div
        data-testid="dialog-overlay"
        aria-hidden
        className="absolute inset-0 bg-black/50 animate-in fade-in-0"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      />
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hasDescription ? descriptionId : undefined}
        className={cn(
          "relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-t-xl border border-border bg-card text-card-foreground shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 sm:max-w-lg sm:rounded-lg",
          className,
        )}
        {...props}
        onKeyDown={handleKeyDown}
      >
        <DialogClose />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );
}

type DialogCloseProps = React.ComponentPropsWithoutRef<typeof Button>;

export const DialogClose = React.forwardRef<
  HTMLButtonElement,
  DialogCloseProps
>(({ className, ...props }, ref) => {
  const { setOpen } = useDialogContext("DialogClose");
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Fechar"
      className={cn("absolute right-3 top-3 h-8 w-8", className)}
      onClick={() => setOpen(false)}
      {...props}
    >
      <X className="h-4 w-4" />
    </Button>
  );
});
DialogClose.displayName = "DialogClose";

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 px-5 pb-0 pt-5 pr-12", className)}
      {...props}
    />
  );
}
DialogHeader.displayName = "DialogHeader";

export function DialogTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDialogContext("DialogTitle");
  return (
    <h2
      id={titleId}
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}
DialogTitle.displayName = "DialogTitle";

export function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId, setHasDescription } =
    useDialogContext("DialogDescription");

  React.useEffect(() => {
    setHasDescription(true);
    return () => setHasDescription(false);
  }, [setHasDescription]);

  return (
    <p
      id={descriptionId}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
DialogDescription.displayName = "DialogDescription";

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 px-5 pb-5 pt-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}
DialogFooter.displayName = "DialogFooter";