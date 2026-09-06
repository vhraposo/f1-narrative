"use client";

import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
};

type SelectContextValue = {
  value: string;
  options: SelectOption[];
  placeholder?: string;
  open: boolean;
  toggle: () => void;
  close: () => void;
  select: (option: SelectOption) => void;
  activeIndex: number | null;
  setActiveIndex: (index: number | null) => void;
  triggerId: string;
  contentId: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const context = React.useContext(SelectContext);
  if (!context) {
    throw new Error("Select parts must be used within a <Select>");
  }
  return context;
}

function mergeRefs<T>(
  ...refs: Array<React.Ref<T> | undefined>
): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref && typeof ref === "object" && "current" in ref) {
        (ref as React.MutableRefObject<T | null>).current = node;
      }
    }
  };
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const id = React.useId();
  const triggerId = `select-trigger-${id}`;
  const contentId = `select-content-${id}`;

  const toggle = React.useCallback(() => {
    setOpen((prev) => !prev);
    setActiveIndex(null);
  }, []);

  const close = React.useCallback(() => {
    setOpen(false);
    setActiveIndex(null);
    triggerRef.current?.focus();
  }, []);

  const select = React.useCallback(
    (option: SelectOption) => {
      onValueChange(option.value);
      setOpen(false);
      setActiveIndex(null);
      triggerRef.current?.focus();
    },
    [onValueChange],
  );

  React.useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) {
        setOpen(false);
        setActiveIndex(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const contextValue = React.useMemo<SelectContextValue>(
    () => ({
      value,
      options,
      placeholder,
      open,
      toggle,
      close,
      select,
      activeIndex,
      setActiveIndex,
      triggerId,
      contentId,
      triggerRef,
      contentRef,
    }),
    [
      value,
      options,
      placeholder,
      open,
      toggle,
      close,
      select,
      activeIndex,
      triggerId,
      contentId,
    ],
  );

  return (
    <SelectContext.Provider value={contextValue}>
      <div ref={rootRef} className={cn("relative inline-flex w-full", className)}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

export function SelectValue({ className }: { className?: string }) {
  const { value, options, placeholder } = useSelectContext();
  const selected = options.find((option) => option.value === value);

  return (
    <span
      className={cn(
        "truncate",
        selected ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {selected ? selected.label : (placeholder ?? value)}
    </span>
  );
}

export const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function SelectTrigger(
  { className, children, onKeyDown, disabled, ...props },
  ref,
) {
  const { open, toggle, triggerId, contentId, triggerRef } = useSelectContext();

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (open) return;
    if (["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      toggle();
    }
  }

  return (
    <button
      ref={mergeRefs(ref, triggerRef)}
      id={triggerId}
      type="button"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? contentId : undefined}
      data-state={open ? "open" : "closed"}
      onKeyDown={handleKeyDown}
      onClick={() => toggle()}
      className={cn(
        "inline-flex h-9 w-full cursor-pointer touch-manipulation items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm ring-offset-background transition-colors motion-safe:transition-colors placeholder:text-muted-foreground hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        open && "border-brand",
        className,
      )}
      {...props}
    >
      {children ?? <SelectValue />}
      <ChevronDown
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-safe:transition-transform",
          open && "rotate-180 text-brand",
        )}
        aria-hidden="true"
      />
    </button>
  );
});
SelectTrigger.displayName = "SelectTrigger";

export function SelectContent({ className }: { className?: string }) {
  const context = useSelectContext();
  const {
    open,
    options,
    value,
    select,
    close,
    activeIndex,
    setActiveIndex,
    triggerId,
    contentId,
    contentRef,
  } = context;

  React.useEffect(() => {
    if (!open) return;
    const items = contentRef.current?.querySelectorAll<HTMLElement>(
      '[role="option"]',
    );
    if (!items) return;
    const selectedIndex = options.findIndex((option) => option.value === value);
    items[selectedIndex >= 0 ? selectedIndex : 0]?.focus();
  }, [open, options, value, contentRef]);

  if (!open) {
    return null;
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    if (items.length === 0) return;

    function move(index: number) {
      setActiveIndex(index);
      items[index]?.focus();
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(
          activeIndex == null
            ? 0
            : Math.min(activeIndex + 1, items.length - 1),
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        move(
          activeIndex == null
            ? items.length - 1
            : Math.max(activeIndex - 1, 0),
        );
        break;
      case "Home":
        event.preventDefault();
        move(0);
        break;
      case "End":
        event.preventDefault();
        move(items.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (activeIndex != null && options[activeIndex]) {
          select(options[activeIndex]);
        }
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        close();
        break;
    }
  }

  return (
    <div
      id={contentId}
      ref={contentRef}
      role="listbox"
      aria-labelledby={triggerId}
      onKeyDown={handleKeyDown}
      className={cn(
        "absolute left-0 top-full z-50 mt-1 flex w-max min-w-full max-w-[calc(100vw-1rem)] flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95",
        className,
      )}
    >
      {options.map((option, index) => (
        <SelectItem key={option.value} option={option} index={index}>
          {option.label}
        </SelectItem>
      ))}
    </div>
  );
}

export function SelectItem({
  option,
  index,
  className,
  children,
}: {
  option: SelectOption;
  index: number;
  className?: string;
  children: React.ReactNode;
}) {
  const { value, select, activeIndex, setActiveIndex } = useSelectContext();
  const selected = value === option.value;
  const highlighted = activeIndex === index;

  return (
    <div
      role="option"
      aria-selected={selected}
      data-value={option.value}
      tabIndex={-1}
      onMouseEnter={() => setActiveIndex(index)}
      onFocus={() => setActiveIndex(index)}
      onClick={() => select(option)}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm outline-none transition-colors motion-safe:transition-colors",
        highlighted
          ? "bg-accent text-accent-foreground"
          : "text-popover-foreground",
        selected && "font-semibold text-brand",
        className,
      )}
    >
      {children}
      {selected && (
        <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
      )}
    </div>
  );
}