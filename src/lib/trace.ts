/**
 * Traceability. Lot links (heat → lot → GI batch → pack) are stored, so a full
 * trace in either direction is a walk over those links.
 */
import type { DB, Lot } from '../data/types';
import { item, machine, party, employee, lot } from './actions';

export function traceBack(db: DB, packNo: string) {
  const pack = db.packs.find(p => p.no === packNo);
  if (!pack) return null;
  const order = db.orders.find(o => o.id === pack.soId)!;
  const dispatch = pack.dispatchId ? db.dispatches.find(d => d.no === pack.dispatchId) : undefined;
  const invoice = dispatch ? db.invoices.find(i => i.dispatchId === dispatch.id) : undefined;
  const mdcc = dispatch?.mdccId ? db.mdccs.find(m => m.id === dispatch.mdccId) : undefined;
  const tpi = db.tpis.find(t => t.packs.includes(pack.no));
  const batch = pack.giBatchId ? db.batches.find(b => b.id === pack.giBatchId) : undefined;

  // Walk the lot tree from the galvanised lot back to the first operation.
  const chain: Lot[] = [];
  const walk = (no: string) => {
    const l = lot(db, no); if (!l) return;
    chain.push(l);
    (l.parents ?? []).forEach(walk);
  };
  pack.lots.forEach(walk);
  const heatsSeen = new Set(chain.flatMap(l => l.heats));
  const heats = [...heatsSeen].map(heatNo => {
    const grn = db.grns.find(g => g.lines.some(x => x.heatNo === heatNo));
    return { heatNo, grn, supplier: grn ? party(db, grn.vendorId).name : undefined };
  });
  const jobCards = chain.filter(l => l.woId).map(l => {
    const w = db.workOrders.find(x => x.id === l.woId)!;
    return { lot: l, wo: w, machine: machine(db, w.machineId), operator: employee(db, w.operatorId)?.name ?? '—' };
  });
  return { pack, order, customer: party(db, order.customerId).name, item: item(db, pack.itemId), dispatch, invoice, mdcc, tpi, batch, chain, jobCards, heats };
}

/** Forward: every pack, dispatch and customer that holds material from a heat. */
export function traceHeat(db: DB, heatNo: string) {
  const lots = db.lots.filter(l => l.heats.includes(heatNo));
  const lotNos = new Set(lots.map(l => l.no));
  const packs = db.packs.filter(p => p.lots.some(n => lotNos.has(n)));
  const dispatches = db.dispatches.filter(d => d.packs.some(n => packs.some(p => p.no === n)));
  const customers = [...new Set(dispatches.map(d => party(db, db.orders.find(o => o.id === d.soId)!.customerId).name))];
  const grn = db.grns.find(g => g.lines.some(x => x.heatNo === heatNo));
  return { heatNo, grn, lots, packs, dispatches, customers };
}

/** What a search term is: a pack, lot, heat, invoice or dispatch number. */
export function identify(db: DB, q: string) {
  const s = q.trim().toUpperCase();
  if (!s) return null;
  if (db.packs.some(p => p.no.toUpperCase() === s)) return { kind: 'pack' as const, id: db.packs.find(p => p.no.toUpperCase() === s)!.no };
  const inv = db.invoices.find(i => i.no.toUpperCase() === s);
  if (inv) { const d = db.dispatches.find(x => x.id === inv.dispatchId)!; return { kind: 'pack' as const, id: d.packs[0] }; }
  const dc = db.dispatches.find(d => d.no.toUpperCase() === s);
  if (dc) return { kind: 'pack' as const, id: dc.packs[0] };
  const l = db.lots.find(x => x.no.toUpperCase() === s);
  if (l) {
    const pack = db.packs.find(p => p.lots.some(n => n === l.no || lineageOf(db, n).includes(l.no)));
    return pack ? { kind: 'pack' as const, id: pack.no } : { kind: 'lot' as const, id: l.no };
  }
  if (db.lots.some(x => x.heats.some(h => h.toUpperCase() === s)) || db.grns.some(g => g.lines.some(x => x.heatNo.toUpperCase() === s))) {
    const heat = db.grns.flatMap(g => g.lines.map(x => x.heatNo)).concat(db.lots.flatMap(x => x.heats)).find(h => h.toUpperCase() === s)!;
    return { kind: 'heat' as const, id: heat };
  }
  return null;
}

function lineageOf(db: DB, lotNo: string): string[] {
  const l = lot(db, lotNo);
  if (!l?.parents?.length) return [];
  return l.parents.flatMap(p => [p, ...lineageOf(db, p)]);
}
