/**
 * The stock ledger. Only this file writes stock movements; every other module
 * calls these helpers. Stock is always the sum of ledger rows, never typed in.
 */
import type { DB, LedgerRow, MoveType, Stage, StockStatus, Activity, ModuleId } from '../data/types';
import { stockOf, docNumber } from './plant';
import { todayISO } from './format';

/* A movable "today" so the seed can play out the last few weeks through the same rules. */
let clockDate: string | null = null;
let clockShift: 'Day' | 'Night' = 'Day';
export const today = () => clockDate ?? todayISO();
export const currentShift = () => clockShift;
export function setClock(date: string | null, shift: 'Day' | 'Night' = 'Day') { clockDate = date; clockShift = shift; }

let rowSeq = 0;
export function post(db: DB, row: Omit<LedgerRow, 'id' | 'ts' | 'plant' | 'user' | 'date'> & { plant?: LedgerRow['plant']; date?: string }) {
  db.ledger.push({
    ...row, id: `L${Date.now().toString(36)}${(rowSeq++).toString(36)}`, ts: clockDate ? new Date(`${clockDate}T12:00:00`).getTime() + rowSeq : Date.now(),
    date: row.date ?? today(), plant: row.plant ?? db.plant, user: db.role,
  });
}

/** Moves stock between stages or statuses as a pair of rows, so the ledger always balances. */
export function move(db: DB, args: {
  type: MoveType; ref: string; itemId: string; lotOrHeat: string; pcs: number; kg: number;
  from: { stage: Stage; status: StockStatus; soId?: string }; to: { stage: Stage; status: StockStatus; soId?: string; lotOrHeat?: string };
}) {
  post(db, { type: args.type, ref: args.ref, itemId: args.itemId, lotOrHeat: args.lotOrHeat, stage: args.from.stage, status: args.from.status, soId: args.from.soId, pcs: -args.pcs, kg: -args.kg });
  post(db, { type: args.type, ref: args.ref, itemId: args.itemId, lotOrHeat: args.to.lotOrHeat ?? args.lotOrHeat, stage: args.to.stage, status: args.to.status, soId: args.to.soId, pcs: args.pcs, kg: args.kg });
}

export const heldAs = (db: DB, lotOrHeat: string, status: StockStatus) => stockOf(db.ledger, { lotOrHeat, status });

/** Where a lot or heat sits right now: the stage and status with stock left. */
export function positions(db: DB, lotOrHeat: string) {
  const map = new Map<string, { stage: Stage; status: StockStatus; soId?: string; pcs: number; kg: number; itemId: string }>();
  for (const r of db.ledger) {
    if (r.lotOrHeat !== lotOrHeat) continue;
    const k = `${r.stage}|${r.status}|${r.soId ?? ''}`;
    const e = map.get(k) ?? { stage: r.stage, status: r.status, soId: r.soId, pcs: 0, kg: 0, itemId: r.itemId };
    e.pcs += r.pcs; e.kg += r.kg;
    map.set(k, e);
  }
  return [...map.values()].filter(e => e.kg > 0.0005 || e.pcs > 0).map(e => ({ ...e, kg: Math.round(e.kg * 1000) / 1000 }));
}

export function seq(db: DB, key: string) {
  db.counters[key] = (db.counters[key] ?? 0) + 1;
  return db.counters[key];
}
export const nextDoc = (db: DB, type: string) => docNumber(db.plant, type, today(), seq(db, `${db.plant}/${type}`));

export function log(db: DB, module: ModuleId, text: string) {
  const ts = clockDate ? new Date(`${clockDate}T${clockShift === 'Day' ? '10' : '22'}:00:00`).getTime() + (rowSeq % 500) * 60000 : Date.now();
  const a: Activity = { id: `A${Date.now().toString(36)}${(rowSeq++).toString(36)}`, ts, module, text };
  db.activity.unshift(a);
  db.activity = db.activity.slice(0, 60);
}
