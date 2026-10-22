"use client";
import { useSyncExternalStore } from "react";

// Who is deciding. Kept in this browser only; every decision stores the name with it.
const KEY = "freshroots.approver";
const EVENT = "freshroots-approver";

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}
export function setApprover(name: string) {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* storage blocked: the name lives for this page only */
  }
  window.dispatchEvent(new Event(EVENT));
}
export function useApprover(): string {
  return useSyncExternalStore(subscribe, read, () => "");
}
