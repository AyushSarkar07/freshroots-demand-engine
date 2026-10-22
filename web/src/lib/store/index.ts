import "server-only";
import { getConfig } from "../config";
import { MemoryStore } from "./memory";
import { PostgresStore } from "./postgres";
import type { Store } from "./types";

let cached: Store | null = null;
export function getStore(): Store {
  return (cached ??= getConfig().db === "postgres" ? new PostgresStore() : new MemoryStore());
}
export function setStoreForTests(s: Store | null) {
  cached = s;
}
