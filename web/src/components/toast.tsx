"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconClose } from "./icons";

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: "success" | "error" | "info";
  action?: { label: string; run: () => void };
}
type Push = (t: Omit<Toast, "id">) => void;

const ToastContext = createContext<Push>(() => {});
export const useToast = () => useContext(ToastContext);

/** Toasts confirm what the server has already accepted. They never announce optimistic success. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>((t) => {
    const id = ++seq.current;
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => <ToastItem key={t.id} toast={t} onDone={() => dismiss(t.id)} />)}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, toast.action ? 7000 : 4500);
    return () => clearTimeout(timer);
  }, [onDone, toast.action]);
  const icon = toast.tone === "error" ? <IconAlert className="text-under" /> : <IconCheck className="text-spice" />;
  return (
    <div role={toast.tone === "error" ? "alert" : "status"}
      className="on-dark pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[var(--radius-lg)] border border-night-line bg-night px-4 py-3 text-cream shadow-[var(--shadow-3)] [animation:toast-in_var(--dur)_var(--ease)_both]">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{toast.title}</div>
        {toast.body && <div className="mt-0.5 text-[12.5px] text-mist">{toast.body}</div>}
      </div>
      {toast.action && (
        <button onClick={() => { toast.action!.run(); onDone(); }} className="shrink-0 rounded-md px-2 py-1 text-[12.5px] font-semibold text-spice hover:bg-night-3">
          {toast.action.label}
        </button>
      )}
      <button onClick={onDone} aria-label="Dismiss" className="shrink-0 rounded-md p-1 text-mist hover:bg-night-3 hover:text-cream"><IconClose width={14} height={14} /></button>
    </div>
  );
}
