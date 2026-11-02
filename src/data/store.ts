import { useSyncExternalStore } from 'react';
import type { DB } from './types';
import { createSeed, DB_VERSION } from './seed';

/**
 * The demo's whole database: one object in memory, saved to this browser only.
 * Nothing is sent to a server.
 */
const KEY = 'macanx-fastener-demo:db';

function load(): DB {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed?.version === DB_VERSION) return parsed;
    }
  } catch { /* private window or blocked storage: start fresh */ }
  return createSeed();
}

let state: DB = load();
const listeners = new Set<() => void>();

function save() {
  try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked: keep working in memory */ }
}

export function getDB() { return state; }

export function useDB(): DB {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);
}

/**
 * Runs an action on a copy of the data. When the action refuses (returns a message),
 * nothing is kept, so a refused step never leaves half a change behind.
 */
export function act<R>(fn: (db: DB) => R): R {
  const draft = structuredClone(state);
  const result = fn(draft);
  if (typeof result !== 'string') {
    state = draft;
    save();
    listeners.forEach(l => l());
  }
  return result;
}

export function resetDemo() {
  state = createSeed();
  save();
  listeners.forEach(l => l());
}
