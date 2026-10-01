"use client";

import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastTone = "info" | "success" | "error";

type ToastInput = {
  message: string;
  tone?: ToastTone;
  persistent?: boolean;
  duration?: number;
};

type ToastState = {
  id: number;
  message: string;
  tone: ToastTone;
  persistent: boolean;
  duration: number;
};

type ToastContextValue = {
  show: (input: ToastInput) => number;
  update: (id: number, input: ToastInput) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  return (
    context ?? {
      show: () => 0,
      update: () => undefined,
      dismiss: () => undefined,
    }
  );
}

const TONE_CLASSES: Record<ToastTone, string> = {
  info: "border-border bg-card text-foreground",
  success:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  error:
    "border-destructive/40 bg-destructive/10 text-destructive",
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastState;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    if (toast.persistent) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.persistent, toast.duration, onDismiss]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
      className={`pointer-events-auto flex w-80 items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg ${TONE_CLASSES[toast.tone]}`}
    >
      <span>{toast.message}</span>
      <button
        type="button"
        aria-label="Fechar notificação"
        className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => onDismiss(toast.id)}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastProvider({
  children,
  defaultDuration = 3500,
}: {
  children: ReactNode;
  defaultDuration?: number;
}) {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [
        ...current,
        {
          id,
          message: input.message,
          tone: input.tone ?? "info",
          persistent: input.persistent ?? false,
          duration: input.duration ?? defaultDuration,
        },
      ]);
      return id;
    },
    [defaultDuration],
  );

  const update = useCallback(
    (id: number, input: ToastInput) => {
      setToasts((current) =>
        current.map((toast) =>
          toast.id === id
            ? {
                ...toast,
                message: input.message,
                tone: input.tone ?? toast.tone,
                persistent: input.persistent ?? false,
                duration: input.duration ?? defaultDuration,
              }
            : toast,
        ),
      );
    },
    [defaultDuration],
  );

  const value = useMemo(() => ({ show, update, dismiss }), [show, update, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-label="Notificações"
        className="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-2"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
