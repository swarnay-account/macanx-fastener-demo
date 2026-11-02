/** Plant measures used by the dashboard and the reports, all derived from transactions. */
import type { DB, SalesOrder } from '../data/types';
import { item, machine, lineCounts, routingFor, OP_STAGE } from './actions';
import { zincPickup, oee, SHIFT_HOURS, kgFromPcs, stockOf } from './plant';
import { daysAgo, addDays } from './format';
import { today } from './inventory';

export const DISPATCH_TARGET_MT = 60; // per month

export function inPlant(db: DB) {
  const machines = new Set(db.machines.filter(m => m.plant === db.plant).map(m => m.id));
  return {
    orders: db.orders.filter(o => o.plant === db.plant),
    workOrders: db.workOrders.filter(w => machines.has(w.machineId)),
    lots: db.lots.filter(l => !l.machineId || machines.has(l.machineId) || db.orders.find(o => o.id === l.soId)?.plant === db.plant),
    batches: db.batches.filter(b => machines.has(b.kettleId)),
    machines: db.machines.filter(m => m.plant === db.plant),
  };
}

/** Planned vs produced pieces at heading, by day. */
export function planVsActual(db: DB, days = 7) {
  const { workOrders } = inPlant(db);
  return Array.from({ length: days }, (_, i) => {
    const d = daysAgo(days - 1 - i);
    const plan = workOrders.filter(w => w.operation === 'Heading' && w.date === d).reduce((s, w) => s + w.targetPcs, 0);
    const act = db.lots.filter(l => l.stage === 'FORGED' && l.date === d && workOrders.some(w => w.id === l.woId)).reduce((s, l) => s + l.pcs, 0);
    return { date: d, plan, act };
  });
}

export function scrapByMachine(db: DB) {
  const { workOrders, machines } = inPlant(db);
  return machines.filter(m => m.type === 'Header' || m.type === 'Thread roller').map(m => {
    const ws = workOrders.filter(w => w.machineId === m.id && w.issued.length);
    const input = ws.reduce((s, w) => s + w.issued.reduce((a, x) => a + x.kg, 0), 0);
    const scrap = ws.reduce((s, w) => s + w.scrapKg + w.rejectKg, 0);
    return { machine: m, input, scrap, pct: input ? scrap / input * 100 : 0 };
  });
}

export function giByKettle(db: DB, days = 7) {
  const { batches, machines } = inPlant(db);
  const from = daysAgo(days - 1);
  return machines.filter(m => m.type === 'GI kettle').map(k => {
    const bs = batches.filter(b => b.kettleId === k.id && b.date >= from && b.post === 'Pass');
    const kg = bs.reduce((s, b) => s + b.giKg, 0);
    const pick = bs.length ? bs.reduce((s, b) => s + zincPickup(b.blackKg, b.giKg), 0) / bs.length : 0;
    return { kettle: k, batches: bs.length, kg, perDay: kg / days, pickup: pick };
  });
}

/** Dispatch over the last 30 days against the monthly target. */
export function dispatchMtd(db: DB) {
  const first = daysAgo(29);
  const ds = db.dispatches.filter(d => d.date >= first && db.orders.find(o => o.id === d.soId)?.plant === db.plant);
  const kg = ds.reduce((s, d) => s + d.kg, 0);
  const value = db.invoices.filter(i => i.date >= first).reduce((s, i) => s + i.taxable, 0);
  return { kg, value, count: ds.length, targetKg: DISPATCH_TARGET_MT * 1000 };
}

export function pendingMdcc(db: DB) {
  const rows: { so: SalesOrder; lineId: string; itemId: string; pcs: number }[] = [];
  for (const o of inPlant(db).orders) {
    if (!o.mdcc) continue;
    for (const l of o.lines) {
      const c = lineCounts(db, o.id, l.id);
      const waiting = (o.tpi ? c.tpiAccepted : c.packed) - c.mdcc;
      if (waiting > 0) rows.push({ so: o, lineId: l.id, itemId: l.itemId, pcs: waiting });
    }
  }
  return rows;
}

export function overduePos(db: DB) {
  return db.pos.filter(p => p.status === 'Open' && p.due < today());
}

export function downtimeByReason(db: DB, days = 30) {
  const from = daysAgo(days - 1);
  const ms = new Set(inPlant(db).machines.map(m => m.id));
  const map = new Map<string, number>();
  for (const d of db.downtime) if (d.date >= from && ms.has(d.machineId)) map.set(d.reason, (map.get(d.reason) ?? 0) + d.minutes);
  return [...map.entries()].map(([reason, minutes]) => ({ reason, minutes })).sort((a, b) => b.minutes - a.minutes);
}

/** OEE per machine over the last N days, from job cards and downtime. */
export function oeeByMachine(db: DB, days = 14) {
  const from = daysAgo(days - 1);
  const { workOrders, machines } = inPlant(db);
  return machines.filter(m => m.ratedPcsHr > 0).map(m => {
    const ws = workOrders.filter(w => w.machineId === m.id && w.date >= from && w.outputPcs > 0);
    const shifts = new Set(ws.map(w => `${w.date}${w.shift}`)).size;
    const plannedMin = shifts * SHIFT_HOURS * 60;
    const down = db.downtime.filter(d => d.machineId === m.id && d.date >= from && ws.some(w => w.date === d.date && w.shift === d.shift)).reduce((s, d) => s + d.minutes, 0);
    const good = ws.reduce((s, w) => s + w.outputPcs, 0);
    const rejected = ws.reduce((s, w) => s + Math.round(w.rejectKg * 1000 / (item(db, w.itemId).kgPer1000 || 1)), 0);
    const r = oee(plannedMin, down, good + rejected, m.ratedPcsHr, good);
    const allDown = db.downtime.filter(d => d.machineId === m.id && d.date >= from).reduce((s, d) => s + d.minutes, 0);
    return { machine: m, shifts, plannedMin, downMin: down, allDownMin: allDown, good, ...r };
  });
}

export function pmStatus(db: DB) {
  return db.pm.filter(p => machine(db, p.machineId).plant === db.plant).map(p => {
    const due = addDays(p.lastDone, p.everyDays);
    const state = due < today() ? 'Overdue' : due <= addDays(today(), 3) ? 'Due' : 'Planned';
    return { pm: p, due, state };
  });
}

/** Lines of SO with step-by-step balances, for the status board. */
export function lineProgress(db: DB, soId: string, lineId: string) {
  const o = db.orders.find(x => x.id === soId)!;
  const l = o.lines.find(x => x.id === lineId)!;
  const it = item(db, l.itemId);
  const planned = db.workOrders.filter(w => w.lineId === lineId && w.operation === 'Heading').reduce((s, w) => s + w.targetPcs, 0);
  const buyPos = db.pos.filter(p => p.soId === soId && p.kind === 'Outsourced' && p.lines[0].itemId === l.itemId && p.status !== 'Rejected');
  const onVendorKg = buyPos.reduce((s, p) => s + Math.max(0, p.lines[0].qtyKg - p.lines[0].receivedKg), 0);
  const boughtIn = db.lots.filter(x => x.soId === soId && x.itemId === l.itemId && x.source === 'Bought' && x.status !== 'Rejected').reduce((s, x) => s + x.pcs, 0);
  const finalStage = it.type === 'Bought-out' ? null : OP_STAGE[routingFor(db, it.id)[routingFor(db, it.id).length - 1]];
  const produced = finalStage ? db.lots.filter(x => x.soId === soId && x.itemId === l.itemId && x.stage === finalStage && x.source === 'In-house').reduce((s, x) => s + x.pcs, 0) : 0;
  const galvanised = db.lots.filter(x => x.soId === soId && x.itemId === l.itemId && x.stage === 'GALV').reduce((s, x) => s + x.pcs, 0);
  const c = lineCounts(db, soId, lineId);
  return {
    line: l, item: it,
    steps: [
      { label: 'Ordered', value: l.qtyPcs },
      { label: 'Planned', value: planned, skipped: l.inhousePcs === 0 },
      { label: 'On order with vendor', value: Math.round(onVendorKg * 1000 / it.kgPer1000), skipped: l.inhousePcs === l.qtyPcs },
      { label: 'Produced / received', value: produced + boughtIn },
      { label: 'Galvanised', value: galvanised },
      { label: 'Packed', value: c.packed },
      { label: 'TPI accepted', value: c.tpiAccepted, skipped: !o.tpi },
      { label: 'MDCC received', value: c.mdcc, skipped: !o.mdcc },
      { label: 'Dispatched', value: c.dispatched },
      { label: 'Invoiced', value: c.invoiced },
    ],
    counts: c,
    balance: l.qtyPcs - c.dispatched,
    kg: kgFromPcs(it, l.qtyPcs),
  };
}

export function soValue(o: SalesOrder) { return o.lines.reduce((s, l) => s + l.qtyPcs * l.rate, 0); }

export function stageStock(db: DB) {
  const prod = new Set(db.items.filter(i => i.type !== 'Consumable' && i.type !== 'Scrap').map(i => i.id));
  return db.ledger.filter(r => prod.has(r.itemId) && r.plant === db.plant);
}
export const holdKg = (db: DB) => stockOf(stageStock(db), { status: 'Quality hold' }).kg;
