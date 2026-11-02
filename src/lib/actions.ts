/**
 * Every business action in the plant. Each one edits the draft DB and returns an
 * error message when a rule refuses it. Screens and the sample-data story both
 * call these, so the demo data obeys the same rules a user does.
 */
import type {
  DB, SalesOrder, SoLine, Approval, ApprovalKind, Role, Quote, GrnLine, Grn, WorkOrder, Operation, Lot, Shift, Stage, Pack,
  DowntimeReason, StockStatus,
} from '../data/types';
import { post, move, positions, seq, nextDoc, log, today, currentShift } from './inventory';
import {
  kgFromPcs, pcsFromKg, maxYieldPcs, jobCardBalance, zincPickup, zincInBand, coatingPasses, COATING_SPEC, ZINC_BAND,
  weighbridgeVariance, landedPerKg, dispatchCap, lotNumber, round3, stockOf, SHIFT_HOURS,
} from './plant';
import { addDays } from './format';

type Result = string | void;
const err = (m: string): string => m;
/** Whole number with Indian grouping, for messages. */
const n = (x: number) => Math.round(x).toLocaleString('en-IN');
const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const item = (db: DB, id: string) => db.items.find(i => i.id === id)!;
export const machine = (db: DB, id: string) => db.machines.find(m => m.id === id)!;
export const party = (db: DB, id: string) => db.parties.find(p => p.id === id)!;
export const so = (db: DB, id: string) => db.orders.find(o => o.id === id)!;
export const bomFor = (db: DB, itemId: string) => db.boms.find(b => b.itemId === itemId);
export const lot = (db: DB, no: string) => db.lots.find(l => l.no === no);
export const employee = (db: DB, id: string) => db.employees.find(e => e.id === id);

/* ---------- approvals ---------- */
export const LIMITS = { indent: 500000, po: 1000000, adjustment: 50000 };
export function requestApproval(db: DB, kind: ApprovalKind, ref: string, text: string, approverRole: Role, value?: number, payload?: unknown) {
  const a: Approval = { id: uid('ap'), date: today(), kind, ref, text, approverRole, value, state: 'Pending', payload };
  db.approvals.unshift(a);
  return a;
}

export function decide(db: DB, approvalId: string, approve: boolean): Result {
  const a = db.approvals.find(x => x.id === approvalId);
  if (!a || a.state !== 'Pending') return err('This approval was already decided.');
  if (db.role !== a.approverRole && db.role !== 'Management' && db.role !== 'Admin') {
    return err(`Only ${a.approverRole} or Management can decide this. Switch role from the top bar to try it.`);
  }
  a.state = approve ? 'Approved' : 'Rejected';
  a.decidedBy = db.role;
  if (!approve) {
    if (a.kind === 'Indent') { const i = db.indents.find(x => x.id === a.ref); if (i) i.status = 'Rejected'; }
    if (a.kind === 'Purchase Order') { const p = db.pos.find(x => x.id === a.ref); if (p) p.status = 'Rejected'; }
    log(db, 'approvals', `${a.kind} for ${a.text} rejected`);
    return;
  }
  switch (a.kind) {
    case 'Sales order': { const o = so(db, a.ref); o.status = 'Approved'; log(db, 'sales', `${o.no} approved and released to planning`); break; }
    case 'Sourcing split': { const o = so(db, a.ref); log(db, 'sales', `Sourcing split on ${o.no} approved`); break; }
    case 'SO amendment': log(db, 'sales', `Amendment ${a.text} approved`); break;
    case 'Indent': { const i = db.indents.find(x => x.id === a.ref)!; i.status = 'Approved'; log(db, 'purchase', `${i.no} approved`); break; }
    case 'Non-lowest vendor': { const r = db.rfqs.find(x => x.id === a.ref)!; createPoFromRfq(db, r.id, a.payload.vendorId, a.payload.reason, true); break; }
    case 'Purchase Order': { const p = db.pos.find(x => x.id === a.ref)!; p.status = 'Open'; log(db, 'purchase', `${p.no} approved and sent to vendor`); break; }
    case 'Quality deviation': return releaseGrn(db, a.ref, 'Accepted with deviation', a.payload?.note);
    case 'Partial RM release': { const w = db.workOrders.find(x => x.id === a.ref)!; w.status = 'Released'; log(db, 'planning', `${w.no} released with partial RM`); break; }
    case 'Machine overload': { const w = db.workOrders.find(x => x.id === a.ref)!; Object.assign(w, a.payload); log(db, 'planning', `${w.no} moved with overload approval`); break; }
    case 'Stock adjustment': {
      const p = a.payload;
      post(db, { type: 'Adjustment', ref: a.id, itemId: p.itemId, lotOrHeat: p.lotOrHeat, stage: p.stage, status: p.status, soId: p.soId, pcs: p.pcs, kg: p.kg });
      log(db, 'stock', `Stock adjustment on ${p.lotOrHeat} posted`); break;
    }
    case 'Short-close': doShortClose(db, a.ref, a.payload.reason); break;
    case 'Shift correction': log(db, 'production', `Correction on ${a.text} approved`); break;
  }
}

/* ---------- sales order ---------- */
export interface NewSo { customerId: string; clientPo: string; poDate: string; project: string; tpi: boolean; mdcc: boolean; tolerancePct: number; packing: string; lines: Omit<SoLine, 'id'>[] }
export function createSalesOrder(db: DB, data: NewSo): string | SalesOrder {
  if (!data.lines.length) return err('Add at least one BOQ line.');
  const unmatched = data.lines.find(l => !l.itemId);
  if (unmatched) return err(`BOQ line “${unmatched.boqText}” is not matched to an item code. The SO cannot be released while a line is unmatched.`);
  for (const l of data.lines) {
    if (l.qtyPcs <= 0) return err('Every line needs a quantity.');
    if (l.inhousePcs < 0 || l.inhousePcs > l.qtyPcs) return err('In-house pieces must be between 0 and the line quantity.');
    if (l.inhousePcs < l.qtyPcs && !l.splitReason) return err('Give a reason for the bought quantity (capacity, size range, delivery date or cost).');
  }
  const o: SalesOrder = {
    id: uid('so'), no: nextDoc(db, 'SO'), plant: db.plant, ...data, status: 'Draft', version: 1, amendments: [],
    lines: data.lines.map(l => ({ ...l, id: uid('ln') })),
  };
  db.orders.unshift(o);
  const value = o.lines.reduce((s, l) => s + l.qtyPcs * l.rate, 0);
  requestApproval(db, 'Sales order', o.id, `${o.no} · ${party(db, o.customerId).name}`, 'Sales', value);
  if (o.lines.some(l => l.inhousePcs < l.qtyPcs)) {
    const bought = o.lines.reduce((s, l) => s + (l.qtyPcs - l.inhousePcs), 0);
    requestApproval(db, 'Sourcing split', o.id, `${o.no}: ${n(bought)} pcs to be bought`, 'Management');
  }
  log(db, 'sales', `${o.no} entered from client PO ${o.clientPo}`);
  return o;
}

export function amendLine(db: DB, soId: string, lineId: string, changes: Partial<Pick<SoLine, 'qtyPcs' | 'rate' | 'due' | 'inhousePcs'>>, reason: string): Result {
  if (!reason.trim()) return err('Every amendment needs a reason.');
  const o = so(db, soId);
  if (o.status === 'Short-closed' || o.status === 'Closed') return err('This order is closed.');
  const l = o.lines.find(x => x.id === lineId)!;
  if (changes.inhousePcs !== undefined && changes.inhousePcs < l.inhousePcs) {
    const made = db.workOrders.filter(w => w.lineId === l.id && w.operation === 'Heading' && w.status !== 'Planned').reduce((s, w) => s + w.targetPcs, 0);
    if (changes.inhousePcs < made) return err(`${n(made)} pcs are already released to production. The split can only change for quantity with no work order.`);
  }
  Object.assign(l, changes);
  o.version += 1;
  o.amendments.push({ version: o.version, date: today(), reason, by: db.role });
  requestApproval(db, 'SO amendment', o.id, `${o.no} rev ${o.version}: ${reason}`, 'Sales');
  log(db, 'sales', `${o.no} amended to rev ${o.version}`);
}

export function requestShortClose(db: DB, soId: string, reason: string): Result {
  if (!reason.trim()) return err('Short-closing needs a reason.');
  const o = so(db, soId);
  requestApproval(db, 'Short-close', o.id, `${o.no}: ${reason}`, 'Management', undefined, { reason });
  log(db, 'sales', `Short-close requested for ${o.no}`);
}
function doShortClose(db: DB, soId: string, reason: string) {
  const o = so(db, soId);
  o.status = 'Short-closed'; o.closeReason = reason;
  const cancelled = db.workOrders.filter(w => w.soId === soId && (w.status === 'Planned' || w.status === 'Released'));
  db.workOrders = db.workOrders.filter(w => !cancelled.includes(w));
  // Reserved stock for the order goes back to free stock.
  const reserved = new Map<string, { itemId: string; stage: Stage; pcs: number; kg: number }>();
  for (const r of db.ledger) if (r.soId === soId && r.status === 'Reserved') {
    const k = `${r.lotOrHeat}|${r.stage}`;
    const e = reserved.get(k) ?? { itemId: r.itemId, stage: r.stage, pcs: 0, kg: 0 };
    e.pcs += r.pcs; e.kg += r.kg; reserved.set(k, e);
  }
  for (const [k, e] of reserved) if (e.kg > 0.0005) {
    move(db, { type: 'Adjustment', ref: o.no, itemId: e.itemId, lotOrHeat: k.split('|')[0], pcs: e.pcs, kg: round3(e.kg), from: { stage: e.stage, status: 'Reserved', soId }, to: { stage: e.stage, status: 'Free' } });
  }
  log(db, 'sales', `${o.no} short-closed; ${cancelled.length} open work orders cancelled`);
}

/* ---------- purchase ---------- */
export function bomNeedKg(db: DB, soId: string, rmItemId: string) {
  const o = so(db, soId);
  let kg = 0;
  for (const l of o.lines) {
    const b = bomFor(db, l.itemId);
    if (b?.rmItemId === rmItemId) kg += l.inhousePcs * b.inputKgPer1000 / 1000 * (1 + b.scrapPct / 100);
  }
  return round3(kg);
}
export const lastPrice = (db: DB, itemId: string) => {
  const p = [...db.pos].reverse().find(x => x.lines.some(l => l.itemId === itemId));
  return p?.lines.find(l => l.itemId === itemId)?.rate ?? 0;
};

export function raiseIndent(db: DB, d: { itemId: string; qtyKg: number; needBy: string; department: string; soId?: string; purpose: string }): Result {
  if (d.qtyKg <= 0) return err('Quantity must be more than zero.');
  if (d.soId) {
    const need = bomNeedKg(db, d.soId, d.itemId);
    const already = db.indents.filter(i => i.soId === d.soId && i.itemId === d.itemId && i.status !== 'Rejected').reduce((s, i) => s + i.qtyKg, 0);
    if (need > 0 && already + d.qtyKg > need * 1.02) {
      return err(`For ${so(db, d.soId).no} the BOM needs ${n(need)} kg including scrap, and ${n(already)} kg is already indented. Reduce the quantity or raise it for stock.`);
    }
  }
  const value = d.qtyKg * (lastPrice(db, d.itemId) || 70);
  const no = nextDoc(db, 'IND');
  const ind = { id: uid('in'), no, date: today(), status: 'Pending' as const, ...d };
  db.indents.unshift(ind);
  requestApproval(db, 'Indent', ind.id, `${no} · ${item(db, d.itemId).name}, ${n(d.qtyKg)} kg`, value > LIMITS.indent ? 'Management' : 'Purchase', value);
  log(db, 'purchase', `${no} raised${d.soId ? ` for ${so(db, d.soId).no}` : ' for stock'}`);
}

export function createRfq(db: DB, indentId: string, quotes: Quote[]): Result {
  const ind = db.indents.find(i => i.id === indentId)!;
  if (ind.status !== 'Approved') return err('Only an approved indent can go to RFQ.');
  if (quotes.length < 2) return err('Get at least two quotes to compare.');
  db.rfqs.unshift({ id: uid('rq'), no: nextDoc(db, 'RFQ'), indentId, date: today(), quotes });
  log(db, 'purchase', `RFQ sent for ${ind.no}`);
}

export function lowestQuote(quotes: Quote[]) {
  return [...quotes].sort((a, b) => landedPerKg(a) - landedPerKg(b))[0];
}

export function choosePoVendor(db: DB, rfqId: string, vendorId: string, reason?: string): Result {
  const r = db.rfqs.find(x => x.id === rfqId)!;
  const lowest = lowestQuote(r.quotes);
  if (vendorId !== lowest.vendorId) {
    if (!reason?.trim()) return err('This vendor is not the lowest landed cost. Give a reason; management will approve.');
    r.chosenVendorId = vendorId; r.reason = reason;
    requestApproval(db, 'Non-lowest vendor', r.id, `${r.no}: ${party(db, vendorId).name} over ${party(db, lowest.vendorId).name}`, 'Management', undefined, { vendorId, reason });
    log(db, 'purchase', `Non-lowest vendor chosen on ${r.no}; sent for approval`);
    return;
  }
  return createPoFromRfq(db, rfqId, vendorId);
}

function createPoFromRfq(db: DB, rfqId: string, vendorId: string, reason?: string, approvedNonLowest = false): Result {
  const r = db.rfqs.find(x => x.id === rfqId)!;
  const ind = db.indents.find(i => i.id === r.indentId)!;
  const q = r.quotes.find(x => x.vendorId === vendorId)!;
  r.chosenVendorId = vendorId; if (reason) r.reason = reason;
  const value = Math.round(ind.qtyKg * q.ratePerKg);
  const po = {
    id: uid('po'), no: nextDoc(db, 'PO'), date: today(), vendorId, indentIds: [ind.id], soId: ind.soId, kind: 'Material' as const,
    lines: [{ itemId: ind.itemId, qtyKg: ind.qtyKg, rate: q.ratePerKg, receivedKg: 0 }], tolerancePct: 2,
    due: addDays(today(), q.days), status: 'Pending' as const, value,
  };
  db.pos.unshift(po);
  ind.status = 'On PO';
  requestApproval(db, 'Purchase Order', po.id, `${po.no} · ${party(db, vendorId).name}${approvedNonLowest ? ' (non-lowest, approved)' : ''}`, value > LIMITS.po ? 'Management' : 'Purchase', value);
  log(db, 'purchase', `${po.no} raised on ${party(db, vendorId).name}`);
}

/** The bought part of an SO line becomes a PO for finished or semi-finished goods. */
export function createOutsourcePo(db: DB, soId: string, lineId: string, vendorId: string, ratePerKg: number): Result {
  const o = so(db, soId); const l = o.lines.find(x => x.id === lineId)!;
  const bought = l.qtyPcs - l.inhousePcs;
  const already = db.pos.filter(p => p.soId === soId && p.kind === 'Outsourced' && p.lines[0].itemId === l.itemId && p.status !== 'Rejected').reduce((s, p) => s + p.lines[0].qtyKg, 0);
  const kg = round3(kgFromPcs(item(db, l.itemId), bought) - already);
  if (kg <= 0) return err('The bought quantity for this line is already on order.');
  const value = Math.round(kg * ratePerKg);
  const po = {
    id: uid('po'), no: nextDoc(db, 'PO'), date: today(), vendorId, indentIds: [], soId, kind: 'Outsourced' as const,
    lines: [{ itemId: l.itemId, qtyKg: kg, rate: ratePerKg, receivedKg: 0 }], tolerancePct: 2, due: addDays(today(), 18), status: 'Pending' as const, value,
  };
  db.pos.unshift(po);
  requestApproval(db, 'Purchase Order', po.id, `${po.no} · outsourced ${item(db, l.itemId).name}`, value > LIMITS.po ? 'Management' : 'Purchase', value);
  log(db, 'purchase', `Outsource ${po.no} raised for ${o.no}`);
}

/* ---------- inward & QC ---------- */
export function receiveGrn(db: DB, d: { poId: string; vehicle: string; invoiceNo: string; ewayBill: string; invoiceKg: number; grossKg: number; tareKg: number; lines: GrnLine[]; tc: Grn['tc'] }): string | { grn: Grn; flagged: boolean } {
  const po = db.pos.find(p => p.id === d.poId);
  if (!po || po.status !== 'Open') return err('A GRN can only be made against an open, approved PO.');
  if (!d.vehicle || !d.invoiceNo) return err('Gate entry needs the vehicle and invoice number.');
  if (!d.lines.length) return err('Add the coils or batches received.');
  const total = round3(d.lines.reduce((s, l) => s + l.kg, 0));
  const pl = po.lines[0];
  const allowed = pl.qtyKg * (1 + po.tolerancePct / 100) - pl.receivedKg;
  if (total > allowed + 0.001) return err(`Refused: this receipt is ${n(total)} kg but the PO allows only ${n(allowed)} kg more (PO qty + ${po.tolerancePct}% tolerance).`);
  const wb = weighbridgeVariance(d.invoiceKg, d.grossKg, d.tareKg);
  const flagged = Math.abs(wb.pct) > po.tolerancePct;
  const grn: Grn = {
    id: uid('gr'), no: nextDoc(db, 'GRN'), date: today(), poId: po.id, vendorId: po.vendorId, vehicle: d.vehicle, invoiceNo: d.invoiceNo,
    ewayBill: d.ewayBill, invoiceKg: d.invoiceKg, grossKg: d.grossKg, tareKg: d.tareKg, lines: d.lines, qc: 'Quality hold', tc: d.tc, soId: po.soId,
  };
  db.grns.unshift(grn);
  const it = item(db, pl.itemId);
  for (const l of d.lines) {
    if (po.kind === 'Material') {
      post(db, { type: 'Receipt', ref: grn.no, itemId: it.id, lotOrHeat: l.heatNo, stage: 'RM', status: 'Quality hold', soId: po.soId, pcs: 0, kg: l.kg });
    } else {
      // Bought goods get our own lot number, linked to the vendor batch and heat on their TC.
      const stage: Stage = it.finish === 'HDG' && it.type === 'Bought-out' ? 'GALV' : 'THREADED';
      const no = lotNumber(db.plant, 'BUY', today(), currentShift(), seq(db, `lot:${today()}`));
      const pcs = pcsFromKg(it, l.kg);
      db.lots.push({ no, itemId: it.id, stage, pcs, kg: l.kg, heats: [l.heatNo], date: today(), status: 'Quality hold', soId: po.soId, ipqc: 'Pending', source: 'Bought', vendorBatch: l.heatNo });
      l.pcs = pcs;
      post(db, { type: 'Receipt', ref: grn.no, itemId: it.id, lotOrHeat: no, stage, status: 'Quality hold', soId: po.soId, pcs, kg: l.kg });
    }
  }
  pl.receivedKg = round3(pl.receivedKg + total);
  if (pl.receivedKg >= pl.qtyKg * (1 - po.tolerancePct / 100)) po.status = 'Closed';
  log(db, 'inward', `${grn.no} received from ${party(db, po.vendorId).name}: ${n(total)} kg on quality hold`);
  return { grn, flagged };
}

/** Mill TC against the grade limits. */
export function tcCheck(db: DB, grn: Grn) {
  const it = item(db, db.pos.find(p => p.id === grn.poId)!.lines[0].itemId);
  const g = db.grades.find(x => x.name === it.grade);
  if (!g) return { ok: true, notes: ['No grade limits for this item'] };
  const within = (v: number, range: string) => { const [a, b] = range.split('–').map(Number); return v >= a && v <= b; };
  const notes: string[] = [];
  if (!within(grn.tc.c, g.c)) notes.push(`C ${grn.tc.c}% outside ${g.c}`);
  if (!within(grn.tc.mn, g.mn)) notes.push(`Mn ${grn.tc.mn}% outside ${g.mn}`);
  if (g.b && grn.tc.b !== undefined && !within(grn.tc.b, g.b)) notes.push(`B ${grn.tc.b}% outside ${g.b}`);
  if (!within(grn.tc.tensile, g.tensile)) notes.push(`Tensile ${grn.tc.tensile} MPa outside ${g.tensile}`);
  return { ok: notes.length === 0, notes };
}

export function qcDecision(db: DB, grnId: string, decision: 'Accept' | 'Deviation' | 'Reject', note = ''): Result {
  const g = db.grns.find(x => x.id === grnId)!;
  if (g.qc !== 'Quality hold') return err(`${g.no} is already ${g.qc.toLowerCase()}.`);
  if (decision === 'Accept') {
    const tc = tcCheck(db, g);
    if (!tc.ok) return err(`Mill TC is outside the grade limits (${tc.notes.join('; ')}). Accept with deviation or reject.`);
    return releaseGrn(db, g.id, 'Accepted', note);
  }
  if (decision === 'Deviation') {
    if (!note.trim()) return err('Write the deviation being accepted.');
    requestApproval(db, 'Quality deviation', g.id, `${g.no}: ${note}`, 'QC', undefined, { note });
    log(db, 'inward', `Deviation on ${g.no} sent to QC head`);
    return;
  }
  for (const r of grnPositions(db, g)) {
    move(db, { type: 'Rejection', ref: g.no, itemId: r.itemId, lotOrHeat: r.lotOrHeat, pcs: r.pcs, kg: r.kg, from: { stage: r.stage, status: 'Quality hold', soId: r.soId }, to: { stage: r.stage, status: 'Rejected', soId: r.soId } });
  }
  g.qc = 'Rejected'; g.qcNote = note || 'Rejected at incoming QC';
  db.lots.filter(l => g.lines.some(x => x.heatNo === l.vendorBatch) && l.status === 'Quality hold').forEach(l => { l.status = 'Rejected'; });
  log(db, 'inward', `${g.no} rejected; debit note ${nextDoc(db, 'DN')} raised`);
}

function grnPositions(db: DB, g: Grn) {
  const out: { itemId: string; lotOrHeat: string; stage: Stage; soId?: string; pcs: number; kg: number }[] = [];
  const keys = new Set(db.ledger.filter(r => r.ref === g.no && r.type === 'Receipt').map(r => r.lotOrHeat));
  for (const k of keys) for (const p of positions(db, k)) if (p.status === 'Quality hold') out.push({ itemId: p.itemId, lotOrHeat: k, stage: p.stage, soId: p.soId, pcs: p.pcs, kg: p.kg });
  return out;
}

function releaseGrn(db: DB, grnId: string, result: 'Accepted' | 'Accepted with deviation', note?: string): Result {
  const g = db.grns.find(x => x.id === grnId)!;
  for (const r of grnPositions(db, g)) {
    const to: StockStatus = r.soId ? 'Reserved' : 'Free';
    move(db, { type: 'QC release', ref: g.no, itemId: r.itemId, lotOrHeat: r.lotOrHeat, pcs: r.pcs, kg: r.kg, from: { stage: r.stage, status: 'Quality hold', soId: r.soId }, to: { stage: r.stage, status: to, soId: r.soId } });
    const l = lot(db, r.lotOrHeat); if (l) { l.status = to; l.ipqc = 'Pass'; }
  }
  g.qc = result; g.qcNote = note;
  log(db, 'inward', `${g.no} ${result.toLowerCase()} by QC`);
}

/* ---------- planning ---------- */
export const ROUTING: Record<string, Operation[]> = {
  '8.8': ['Heading', 'Threading', 'Heat treatment'],
  '10.9': ['Heading', 'Threading', 'Heat treatment'],
  '5.6': ['Heading', 'Threading'],
  '4.6': ['Heading', 'Threading'],
};
export const routingFor = (db: DB, itemId: string) => ROUTING[item(db, itemId).propertyClass ?? '5.6'] ?? ['Heading', 'Threading'];
export const OP_STAGE: Record<Operation, Stage> = { Drawing: 'DRAWN', Heading: 'FORGED', Threading: 'THREADED', 'Heat treatment': 'HT' };
const OP_MACHINE: Record<Operation, string> = { Drawing: 'Wire drawing', Heading: 'Header', Threading: 'Thread roller', 'Heat treatment': 'HT furnace' };

export function machinesFor(db: DB, op: Operation, dia: number) {
  return db.machines.filter(m => m.plant === db.plant && m.type === OP_MACHINE[op] && dia >= m.diaMin && dia <= m.diaMax);
}

export function woHours(db: DB, w: Pick<WorkOrder, 'machineId' | 'targetPcs' | 'itemId'>) {
  const m = machine(db, w.machineId);
  const it = item(db, w.itemId);
  const h = m.ratedPcsHr > 0 ? w.targetPcs / m.ratedPcsHr : kgFromPcs(it, w.targetPcs) / m.ratedKgHr;
  return Math.round((h + 0.75) * 10) / 10; // 45 min setup / die change
}
export function pmHours(db: DB, machineId: string, date: string) {
  return db.pm.filter(p => p.machineId === machineId && addDays(p.lastDone, p.everyDays) === date).reduce((s, p) => s + p.hours, 0);
}
export function shiftLoad(db: DB, machineId: string, date: string, shift: Shift, exceptWo?: string) {
  const used = db.workOrders.filter(w => w.machineId === machineId && w.date === date && w.shift === shift && w.id !== exceptWo && w.status !== 'Closed')
    .reduce((s, w) => s + woHours(db, w), 0);
  const blocked = shift === 'Day' ? pmHours(db, machineId, date) : 0;
  const down = machine(db, machineId).status === 'Breakdown' && date === today() ? SHIFT_HOURS : 0;
  return { used: Math.round(used * 10) / 10, available: Math.max(0, SHIFT_HOURS - blocked - down), blocked };
}

/** Net requirement for every released SO line: in-house pieces less what is already planned. */
export function planningRun(db: DB) {
  const rows = [];
  for (const o of db.orders) {
    if (o.plant !== db.plant || !['Approved', 'In production', 'Part dispatched'].includes(o.status)) continue;
    for (const l of o.lines) {
      if (l.inhousePcs <= 0) continue;
      const planned = db.workOrders.filter(w => w.lineId === l.id && w.operation === 'Heading').reduce((s, w) => s + w.targetPcs, 0);
      const net = l.inhousePcs - planned;
      const b = bomFor(db, l.itemId);
      if (!b) continue;
      const rmKg = round3(net * b.inputKgPer1000 / 1000);
      const rmFree = stockOf(db.ledger, { itemId: b.rmItemId, stage: 'RM', status: 'Free', plant: db.plant }).kg
        + stockOf(db.ledger, { itemId: b.rmItemId, stage: 'RM', status: 'Reserved', soId: o.id }).kg;
      rows.push({ soId: o.id, lineId: l.id, itemId: l.itemId, due: l.due, inhouse: l.inhousePcs, planned, net, rmItemId: b.rmItemId, rmKg, rmFree: round3(rmFree), boughtPcs: l.qtyPcs - l.inhousePcs });
    }
  }
  return rows.sort((a, b) => a.due.localeCompare(b.due));
}

/** Creates the machine-wise work orders for one SO line: one per operation in its routing. */
export function planLine(db: DB, soId: string, lineId: string, pcs: number, date: string, shift: Shift = 'Day'): Result {
  const o = so(db, soId); const l = o.lines.find(x => x.id === lineId)!;
  const it = item(db, l.itemId);
  if (pcs <= 0) return err('Nothing left to plan on this line.');
  const ops = routingFor(db, it.id);
  let d = date;
  const created: WorkOrder[] = [];
  for (const op of ops) {
    const options = machinesFor(db, op, it.dia ?? 0);
    if (!options.length) return err(`No ${OP_MACHINE[op].toLowerCase()} in this plant can run M${it.dia}. Outsource this line or move it to the other plant.`);
    // Least-loaded suitable machine on the day.
    const m = [...options].sort((a, b) => shiftLoad(db, a.id, d, shift).used - shiftLoad(db, b.id, d, shift).used)[0];
    const w: WorkOrder = {
      id: uid('wo'), no: nextDoc(db, 'WO'), soId, lineId, itemId: it.id, operation: op, machineId: m.id, date: d, shift,
      targetPcs: pcs, status: 'Planned', operatorId: rosterOperator(db, m.id, d, shift), issued: [], outputPcs: 0, outputKg: 0,
      scrapKg: 0, rejectKg: 0, lots: [], dieSet: op === 'Heat treatment' ? '—' : `DS-M${it.dia}-${op === 'Heading' ? 'H' : 'T'}${(it.length ?? 0) > 100 ? 'L' : ''}`,
    };
    db.workOrders.push(w); created.push(w);
    d = addDays(d, 1);
  }
  if (o.status === 'Approved') o.status = 'In production';
  log(db, 'planning', `${created.length} work orders planned for ${o.no}, ${it.name}`);
}

function rosterOperator(db: DB, machineId: string, date: string, shift: Shift) {
  return db.roster.find(r => r.machineId === machineId && r.shift === shift)?.operatorId
    ?? db.employees.find(e => e.role === 'Operator' && e.skills.includes(machine(db, machineId).type))?.id ?? '';
}

export function releaseWo(db: DB, woId: string): Result | { notice: string } {
  const w = db.workOrders.find(x => x.id === woId)!;
  if (w.status !== 'Planned') return err(`${w.no} is already ${w.status.toLowerCase()}.`);
  if (w.operation === 'Heading') {
    const b = bomFor(db, w.itemId)!;
    const need = round3(w.targetPcs * b.inputKgPer1000 / 1000);
    const have = stockOf(db.ledger, { itemId: b.rmItemId, stage: 'RM', status: 'Free', plant: db.plant }).kg + stockOf(db.ledger, { itemId: b.rmItemId, stage: 'RM', status: 'Reserved', soId: w.soId }).kg;
    if (have < need) {
      requestApproval(db, 'Partial RM release', w.id, `${w.no}: needs ${n(need)} kg ${item(db, b.rmItemId).name}, ${n(have)} kg available`, 'Management');
      // Kept as a change (the approval request), so it is a notice rather than a refusal.
      return { notice: `Raw material is short (${n(have)} of ${n(need)} kg). A partial release was sent to the plant head.` };
    }
  }
  w.status = 'Released';
  log(db, 'planning', `${w.no} released to ${machine(db, w.machineId).code}`);
}

export function moveWo(db: DB, woId: string, machineId: string, date: string, shift: Shift, overrideReason?: string): Result {
  const w = db.workOrders.find(x => x.id === woId)!;
  if (w.status === 'Running' || w.status === 'Closed') return err(`${w.no} is ${w.status.toLowerCase()} and can't be moved.`);
  const m = machine(db, machineId); const it = item(db, w.itemId);
  if (m.type !== machine(db, w.machineId).type) return err(`${w.operation} can only run on a ${machine(db, w.machineId).type.toLowerCase()}.`);
  if ((it.dia ?? 0) < m.diaMin || (it.dia ?? 0) > m.diaMax) return err(`${m.code} runs M${m.diaMin}–M${m.diaMax}; this job is M${it.dia}.`);
  if (m.status === 'Breakdown' && date === today()) return err(`${m.code} is down with a breakdown today.`);
  const load = shiftLoad(db, machineId, date, shift, w.id);
  const hours = woHours(db, { ...w, machineId });
  if (load.used + hours > load.available) {
    if (!overrideReason?.trim()) return err(`${m.code} ${shift.toLowerCase()} shift would be loaded ${n(load.used + hours)} h of ${load.available} h available. Give a reason to request an override.`);
    requestApproval(db, 'Machine overload', w.id, `${w.no} on ${m.code}: ${overrideReason}`, 'Management', undefined, { machineId, date, shift });
    return;
  }
  Object.assign(w, { machineId, date, shift, operatorId: rosterOperator(db, machineId, date, shift) });
  log(db, 'planning', `${w.no} moved to ${m.code}, ${shift} shift`);
}

/* ---------- production ---------- */
export function issueHeat(db: DB, woId: string, heatNo: string, kg: number): Result {
  const w = db.workOrders.find(x => x.id === woId)!;
  if (w.status === 'Planned') return err(`${w.no} is not released yet.`);
  if (w.status === 'Closed') return err(`${w.no} is closed.`);
  if (w.operation !== 'Heading') return err('Raw material is issued to heading. Later operations take lots from the previous stage.');
  const pos = positions(db, heatNo).filter(p => p.stage === 'RM');
  if (!pos.length) return err(`Heat ${heatNo} has no stock.`);
  const b = bomFor(db, w.itemId)!;
  if (pos[0].itemId !== b.rmItemId) return err(`Grade mismatch: heat ${heatNo} is ${item(db, pos[0].itemId).name}; the BOM needs ${item(db, b.rmItemId).name}.`);
  if (pos.some(p => p.status === 'Quality hold')) return err(`Heat ${heatNo} is on quality hold. Nothing on hold can be issued to production.`);
  const usable = pos.filter(p => p.status === 'Free' || (p.status === 'Reserved' && p.soId === w.soId));
  const avail = usable.reduce((s, p) => s + p.kg, 0);
  if (kg <= 0) return err('Enter the kg to issue.');
  if (kg > avail + 0.001) return err(`Heat ${heatNo} has ${n(avail)} kg usable for this order.`);
  let left = kg;
  for (const p of usable.sort((a, b) => (a.status === 'Reserved' ? 0 : 1) - (b.status === 'Reserved' ? 0 : 1))) {
    const take = Math.min(left, p.kg); if (take <= 0) continue;
    post(db, { type: 'Issue', ref: w.no, itemId: p.itemId, lotOrHeat: heatNo, stage: 'RM', status: p.status, soId: p.soId, pcs: 0, kg: -round3(take) });
    left -= take;
  }
  const e = w.issued.find(x => x.heatNo === heatNo);
  if (e) e.kg = round3(e.kg + kg); else w.issued.push({ heatNo, kg: round3(kg) });
  w.status = 'Running';
  machine(db, w.machineId).status = 'Running';
  log(db, 'production', `${n(kg)} kg of heat ${heatNo} issued to ${w.no}`);
}

/** Threading and heat treatment take lots from the previous stage. */
export function issueLot(db: DB, woId: string, lotNo: string): Result {
  const w = db.workOrders.find(x => x.id === woId)!;
  if (w.status === 'Planned') return err(`${w.no} is not released yet.`);
  const l = lot(db, lotNo);
  if (!l) return err(`No lot ${lotNo}.`);
  const ops = routingFor(db, w.itemId);
  const prev = OP_STAGE[ops[ops.indexOf(w.operation) - 1]];
  if (l.itemId !== w.itemId) return err(`${lotNo} is ${item(db, l.itemId).name}, not this job's item.`);
  if (l.stage !== prev) return err(`${lotNo} is at ${l.stage.toLowerCase()} stage; ${w.operation.toLowerCase()} needs lots from ${prev.toLowerCase()}.`);
  if (l.status === 'Quality hold' || l.ipqc === 'Fail') return err(`${lotNo} is on quality hold after in-process QC.`);
  const pos = positions(db, lotNo).find(p => p.stage === prev);
  if (!pos) return err(`${lotNo} has already been used.`);
  post(db, { type: 'Issue', ref: w.no, itemId: l.itemId, lotOrHeat: lotNo, stage: prev, status: pos.status, soId: pos.soId, pcs: -pos.pcs, kg: -pos.kg });
  w.issued.push({ heatNo: lotNo, kg: pos.kg });
  w.status = 'Running';
  log(db, 'production', `${lotNo} issued to ${w.no}`);
}

export function issuedPcs(db: DB, w: WorkOrder) {
  if (w.operation === 'Heading') return 0;
  return w.issued.reduce((s, x) => s + (lot(db, x.heatNo)?.pcs ?? 0), 0);
}

export function recordOutput(db: DB, woId: string, d: { pcs: number; rejectPcs: number; scrapKg: number }): string | Lot {
  const w = db.workOrders.find(x => x.id === woId)!;
  if (w.status !== 'Running') return err(w.status === 'Closed' ? `${w.no} is closed. Corrections after shift close need supervisor approval.` : 'Issue material to the job card first.');
  if (d.pcs <= 0) return err('Enter the good pieces produced.');
  const it = item(db, w.itemId);
  const inputKg = w.issued.reduce((s, x) => s + x.kg, 0);
  if (w.operation === 'Heading') {
    const b = bomFor(db, w.itemId)!;
    const max = maxYieldPcs(inputKg, b.inputKgPer1000);
    if (w.outputPcs + d.pcs + d.rejectPcs > max) return err(`Blocked: ${n(inputKg)} kg issued can yield at most ${n(max)} pcs; ${n(w.outputPcs)} already booked.`);
  } else {
    const max = issuedPcs(db, w);
    if (w.outputPcs + d.pcs + d.rejectPcs > max) return err(`Blocked: ${n(max)} pcs were issued; ${n(w.outputPcs)} already booked.`);
  }
  const kg = kgFromPcs(it, d.pcs);
  const m = machine(db, w.machineId);
  const stage = OP_STAGE[w.operation];
  const no = lotNumber(db.plant, m.code, today(), currentShift(), seq(db, `lot:${today()}`));
  // Lot operations: the parents are the lots issued since the last output entry.
  const used = new Set(w.lots.flatMap(n => lot(db, n)?.parents ?? []));
  const parents = w.operation === 'Heading' ? [] : w.issued.map(x => x.heatNo).filter(n => !used.has(n));
  if (w.operation !== 'Heading' && !parents.length) return err('Issue the next lot before booking more output.');
  const heats = w.operation === 'Heading' ? w.issued.map(x => x.heatNo) : [...new Set(parents.flatMap(p => lot(db, p)?.heats ?? []))];
  const newLot: Lot = {
    no, itemId: it.id, stage, pcs: d.pcs, kg, heats, parents, woId: w.id, machineId: m.id, operatorId: w.operatorId,
    date: today(), shift: currentShift(), status: 'Reserved', soId: w.soId, ipqc: 'Pending', source: 'In-house',
  };
  db.lots.push(newLot);
  post(db, { type: 'Production', ref: w.no, itemId: it.id, lotOrHeat: no, stage, status: 'Reserved', soId: w.soId, pcs: d.pcs, kg });
  const rejectKg = kgFromPcs(it, d.rejectPcs);
  const scrapItem = db.items.find(i => i.type === 'Scrap')!;
  if (d.scrapKg + rejectKg > 0) post(db, { type: 'Scrap', ref: w.no, itemId: scrapItem.id, lotOrHeat: 'SCRAP', stage: 'RM', status: 'Free', pcs: 0, kg: round3(d.scrapKg + rejectKg) });
  w.outputPcs += d.pcs; w.outputKg = round3(w.outputKg + kg); w.scrapKg = round3(w.scrapKg + d.scrapKg); w.rejectKg = round3(w.rejectKg + rejectKg);
  w.lots.push(no);
  const b = bomFor(db, w.itemId);
  if (w.operation === 'Heading' && b && inputKg > 0 && (w.scrapKg / inputKg * 100) > b.scrapPct) {
    log(db, 'production', `Scrap on ${w.no} is above the BOM standard of ${b.scrapPct}%: supervisor alerted`);
  }
  log(db, 'production', `Lot ${no} created: ${n(d.pcs)} pcs on ${m.code}`);
  return newLot;
}

export function ipqc(db: DB, lotNo: string, pass: boolean, note = ''): Result {
  const l = lot(db, lotNo)!;
  const pos = positions(db, lotNo).find(p => p.stage === l.stage);
  if (!pos) return err(`${lotNo} has already moved on.`);
  if (!pass && l.status !== 'Quality hold') {
    move(db, { type: 'Adjustment', ref: `IPQC ${lotNo}`, itemId: l.itemId, lotOrHeat: lotNo, pcs: pos.pcs, kg: pos.kg, from: { stage: l.stage, status: pos.status, soId: pos.soId }, to: { stage: l.stage, status: 'Quality hold', soId: pos.soId } });
    l.status = 'Quality hold';
  }
  if (pass && l.status === 'Quality hold') {
    const to: StockStatus = l.soId ? 'Reserved' : 'Free';
    move(db, { type: 'QC release', ref: `IPQC ${lotNo}`, itemId: l.itemId, lotOrHeat: lotNo, pcs: pos.pcs, kg: pos.kg, from: { stage: l.stage, status: 'Quality hold', soId: pos.soId }, to: { stage: l.stage, status: to, soId: pos.soId } });
    l.status = to;
  }
  l.ipqc = pass ? 'Pass' : 'Fail';
  log(db, 'production', `In-process QC on ${lotNo}: ${pass ? 'pass' : `fail, lot on hold${note ? ` (${note})` : ''}`}`);
}

export function closeJobCard(db: DB, woId: string): Result {
  const w = db.workOrders.find(x => x.id === woId)!;
  if (w.status !== 'Running') return err(`${w.no} has no production to close.`);
  const input = w.issued.reduce((s, x) => s + x.kg, 0);
  const bal = jobCardBalance(input, w.outputKg, w.scrapKg, w.rejectKg);
  if (!bal.ok) return err(`${w.no} does not balance: ${n(input)} kg in, ${n(bal.accounted)} kg out + scrap + rejection (${bal.diffPct}% gap). Book the missing output or scrap first.`);
  w.status = 'Closed';
  log(db, 'production', `${w.no} closed and balanced`);
}

/* ---------- galvanising ---------- */
export const giReadyStage = (db: DB, itemId: string): Stage => {
  const ops = routingFor(db, itemId);
  return OP_STAGE[ops[ops.length - 1]];
};
export function createBatch(db: DB, d: { kettleId: string; lotNos: string[]; tempC: number; dipSec: number; spinSec: number; prePass: boolean }): Result {
  if (!d.lotNos.length) return err('Pick the lots for this batch.');
  if (!d.prePass) return err('Pre-GI check failed: send the lots back for rework before galvanising.');
  const k = machine(db, d.kettleId);
  const lots = d.lotNos.map(n => lot(db, n)!);
  for (const l of lots) {
    const ready = l.source === 'Bought' ? 'THREADED' : giReadyStage(db, l.itemId);
    if (l.stage !== ready) return err(`${l.no} is at ${l.stage.toLowerCase()} stage and is not ready for galvanising.`);
    if (l.status === 'Quality hold' || l.ipqc !== 'Pass') return err(`${l.no} has not passed in-process QC.`);
  }
  const blackKg = round3(lots.reduce((s, l) => s + (positions(db, l.no).find(p => p.stage === l.stage)?.kg ?? 0), 0));
  if (blackKg > (k.loadLimitKg ?? 0)) return err(`Refused: ${n(blackKg)} kg is over ${k.code}'s load limit of ${k.loadLimitKg} kg. Split the lots into two batches.`);
  const no = `GI-${k.code.replace('GI-', 'K')}-${today().slice(2).replace(/-/g, '')}-${String(seq(db, `gi:${today()}`)).padStart(2, '0')}`;
  for (const l of lots) {
    const p = positions(db, l.no).find(x => x.stage === l.stage)!;
    post(db, { type: 'Galvanising', ref: no, itemId: l.itemId, lotOrHeat: l.no, stage: l.stage, status: p.status, soId: p.soId, pcs: -p.pcs, kg: -p.kg });
  }
  db.batches.unshift({
    id: uid('gb'), no, date: today(), shift: currentShift(), kettleId: k.id, type: 'HDG', lots: d.lotNos, blackKg, giKg: 0,
    tempC: d.tempC, dipSec: d.dipSec, spinSec: d.spinSec, coatingMin: 0, coatingAvg: 0, pre: 'Pass', post: 'Pending', status: 'In kettle', zincKg: 0,
  });
  log(db, 'galvanising', `${no} loaded in ${k.code}: ${n(blackKg)} kg black`);
}

export function postGi(db: DB, batchId: string, d: { giKg: number; coatingMin: number; coatingAvg: number }): string | { pickup: number; inBand: boolean; failed?: boolean; notice?: string } {
  const b = db.batches.find(x => x.id === batchId)!;
  if (b.status !== 'In kettle' && b.status !== 'Re-dip') return err(`${b.no} is already done.`);
  if (d.giKg <= b.blackKg) return err('Galvanised weight must be more than the black weight.');
  b.giKg = round3(d.giKg); b.coatingMin = d.coatingMin; b.coatingAvg = d.coatingAvg;
  const pickup = zincPickup(b.blackKg, b.giKg);
  if (!coatingPasses(d.coatingMin, d.coatingAvg)) {
    b.post = 'Fail'; b.status = 'Re-dip'; b.redips = (b.redips ?? 0) + 1;
    log(db, 'galvanising', `${b.no} failed coating (${d.coatingMin}/${d.coatingAvg} µm): strip and re-dip`);
    return { pickup, inBand: zincInBand(pickup), failed: true, notice: `Coating below spec (min ${COATING_SPEC.min} µm, average ${COATING_SPEC.avg} µm). The batch is blocked from packing: strip and re-dip, then enter the new readings.` };
  }
  b.post = 'Pass'; b.status = 'Passed';
  b.zincKg = round3((b.giKg - b.blackKg) * 1.35);
  const zinc = db.items.find(i => i.code === 'CON-ZN')!;
  post(db, { type: 'Issue', ref: b.no, itemId: zinc.id, lotOrHeat: 'ZINC', stage: 'RM', status: 'Free', pcs: 0, kg: -b.zincKg });
  const factor = b.giKg / b.blackKg;
  b.lots.forEach((n, i) => {
    const src = lot(db, n)!;
    const no = `${b.no}-${String(i + 1).padStart(2, '0')}`;
    const kg = round3(src.kg * factor);
    db.lots.push({ no, itemId: src.itemId, stage: 'GALV', pcs: src.pcs, kg, heats: src.heats, parents: [src.no], machineId: b.kettleId, date: today(), shift: b.shift, status: src.soId ? 'Reserved' : 'Free', soId: src.soId, ipqc: 'Pass', source: src.source, batchId: b.id });
    post(db, { type: 'Galvanising', ref: b.no, itemId: src.itemId, lotOrHeat: no, stage: 'GALV', status: src.soId ? 'Reserved' : 'Free', soId: src.soId, pcs: src.pcs, kg });
  });
  const inBand = zincInBand(pickup);
  log(db, 'galvanising', `${b.no} passed: ${d.coatingAvg} µm average, zinc pick-up ${pickup}%${inBand ? '' : ` (outside ${ZINC_BAND.min}–${ZINC_BAND.max}% band, alert raised)`}`);
  return { pickup, inBand };
}
export function handoverBatch(db: DB, batchId: string): Result {
  const b = db.batches.find(x => x.id === batchId)!;
  if (b.status !== 'Passed') return err(b.status === 'Re-dip' ? 'Coating failed: this batch cannot go to packing until it passes.' : `${b.no} is ${b.status.toLowerCase()}.`);
  b.status = 'Handed to packing';
  log(db, 'galvanising', `${b.no} handed over to packing`);
}

/* ---------- packing, TPI, MDCC, dispatch, billing ---------- */
export function packLots(db: DB, soId: string, lineId: string, lotNos: string[], packKg = 25): Result {
  const o = so(db, soId); const ln = o.lines.find(x => x.id === lineId)!; const it = item(db, ln.itemId);
  if (!lotNos.length) return err('Pick the galvanised lots to pack.');
  const perPack = pcsFromKg(it, packKg);
  for (const n of lotNos) {
    const l = lot(db, n)!;
    if (l.itemId !== it.id || l.stage !== 'GALV') return err(`${n} is not galvanised ${it.name}.`);
    const b = l.batchId ? db.batches.find(x => x.id === l.batchId) : undefined;
    if (l.source === 'In-house' && b && b.status === 'In kettle') return err(`${n} is still in the kettle.`);
    const p = positions(db, n).find(x => x.stage === 'GALV');
    if (!p) return err(`${n} is already packed.`);
    let left = p.pcs;
    post(db, { type: 'Packing', ref: o.no, itemId: it.id, lotOrHeat: n, stage: 'GALV', status: p.status, soId: p.soId, pcs: -p.pcs, kg: -p.kg });
    while (left > 0) {
      const pcs = Math.min(perPack, left); left -= pcs;
      const no = `PK${o.no.split('/').pop()}-${String(seq(db, `pack:${o.id}`)).padStart(4, '0')}`;
      const net = kgFromPcs(it, pcs);
      const pack: Pack = { no, soId, lineId, itemId: it.id, giBatchId: l.batchId, lots: [n], pcs, netKg: net, grossKg: round3(net + 0.18), packing: o.packing, state: 'Packed' };
      db.packs.push(pack);
      post(db, { type: 'Packing', ref: o.no, itemId: it.id, lotOrHeat: no, stage: 'PACKED', status: 'Reserved', soId, pcs, kg: net });
    }
  }
  log(db, 'dispatch', `Lots packed for ${o.no}: ${it.name}`);
}

export function offerTpi(db: DB, soId: string, lineId: string, packNos: string[], agencyId: string): Result {
  const o = so(db, soId);
  if (!o.tpi) return err(`${o.no} does not need TPI; the step is skipped and recorded.`);
  const packs = packNos.map(n => db.packs.find(p => p.no === n)!);
  if (!packs.length) return err('Pick the packs to offer.');
  for (const p of packs) {
    if (p.state !== 'Packed') return err(`${p.no} is ${p.state.toLowerCase()}.`);
    const b = p.giBatchId ? db.batches.find(x => x.id === p.giBatchId) : undefined;
    if (b && b.post !== 'Pass') return err(`${p.no} comes from ${b.no}, which has not passed coating QC.`);
  }
  const pcs = packs.reduce((s, p) => s + p.pcs, 0);
  db.tpis.unshift({ id: uid('tp'), no: nextDoc(db, 'TPI'), soId, lineId, agencyId, date: today(), packs: packNos, offeredPcs: pcs, acceptedPcs: 0, rejectedPcs: 0, report: '', status: 'Offered' });
  packs.forEach(p => { p.state = 'TPI offered'; });
  log(db, 'dispatch', `${packs.length} packs offered for TPI on ${o.no}`);
}

export function recordTpi(db: DB, tpiId: string, rejectedPacks: string[], report: string): Result {
  const t = db.tpis.find(x => x.id === tpiId)!;
  if (t.status === 'Done') return err('Inspection already recorded.');
  if (!report.trim()) return err('Enter the inspection report number.');
  let acc = 0, rej = 0;
  for (const n of t.packs) {
    const p = db.packs.find(x => x.no === n)!;
    if (rejectedPacks.includes(n)) { p.state = 'TPI rejected'; rej += p.pcs; } else { p.state = 'TPI accepted'; acc += p.pcs; }
  }
  Object.assign(t, { acceptedPcs: acc, rejectedPcs: rej, report, status: 'Done' });
  log(db, 'dispatch', `${t.no}: ${n(acc)} pcs accepted by TPI`);
}

export function lineCounts(db: DB, soId: string, lineId: string) {
  const packs = db.packs.filter(p => p.soId === soId && p.lineId === lineId);
  const sum = (arr: { pcs: number }[]) => arr.reduce((s, x) => s + x.pcs, 0);
  const tpiAccepted = sum(packs.filter(p => p.state === 'TPI accepted' || (p.state === 'Dispatched' && so(db, soId).tpi)));
  const mdcc = db.mdccs.filter(m => m.soId === soId && m.lineId === lineId).reduce((s, m) => s + m.pcs, 0);
  const mdccUsed = db.mdccs.filter(m => m.soId === soId && m.lineId === lineId).reduce((s, m) => s + m.usedPcs, 0);
  const dispatched = db.dispatches.filter(d => d.soId === soId && d.lineId === lineId).reduce((s, d) => s + d.pcs, 0);
  const invoiced = db.invoices.filter(i => i.soId === soId && i.lineId === lineId).reduce((s, i) => s + i.pcs, 0);
  return { packed: sum(packs), tpiAccepted, mdcc, mdccBalance: mdcc - mdccUsed, dispatched, invoiced };
}

export function requestMdcc(db: DB, soId: string, lineId: string, pcs: number, mdccNo: string): Result {
  const o = so(db, soId);
  if (!o.mdcc) return err(`${o.no} does not need an MDCC; the step is skipped and recorded.`);
  const c = lineCounts(db, soId, lineId);
  const base = o.tpi ? c.tpiAccepted : c.packed;
  const room = base - c.mdcc;
  if (pcs <= 0) return err('Enter the MDCC quantity.');
  if (pcs > room) return err(`Only ${n(room)} pcs are ${o.tpi ? 'TPI-accepted' : 'packed'} and not yet under an MDCC.`);
  if (!mdccNo.trim()) return err('Enter the MDCC number from the customer.');
  db.mdccs.unshift({ id: uid('md'), no: mdccNo.trim(), soId, lineId, date: today(), validTill: addDays(today(), 60), pcs, usedPcs: 0 });
  log(db, 'dispatch', `MDCC ${mdccNo} received for ${o.no}: ${n(pcs)} pcs`);
}

export function dispatchPacks(db: DB, d: { soId: string; lineId: string; packNos: string[]; vehicle: string; transporter: string; lr: string; ewayBill: string }): Result {
  const o = so(db, d.soId); const ln = o.lines.find(x => x.id === d.lineId)!;
  if (!d.packNos.length) return err('Scan or pick the packs being loaded.');
  if (!d.vehicle || !d.lr) return err('Enter the vehicle and LR number.');
  const packs = d.packNos.map(n => db.packs.find(p => p.no === n)!);
  const ready = o.tpi ? 'TPI accepted' : 'Packed';
  const bad = packs.find(p => p.state !== ready);
  if (bad) return err(`${bad.no} is ${bad.state.toLowerCase()}; only ${ready.toLowerCase()} packs can be loaded.`);
  const pcs = packs.reduce((s, p) => s + p.pcs, 0);
  const c = lineCounts(db, d.soId, d.lineId);
  if (o.mdcc && pcs > c.mdccBalance) return err(`Refused: ${n(pcs)} pcs is more than the MDCC balance of ${n(c.mdccBalance)} pcs.`);
  const cap = dispatchCap(ln.qtyPcs, o.tolerancePct, c.dispatched);
  if (pcs > cap) return err(`Refused: only ${n(cap)} more pcs can go on this line (SO qty + ${o.tolerancePct}% tolerance).`);
  const no = nextDoc(db, 'DC');
  const kg = round3(packs.reduce((s, p) => s + p.netKg, 0));
  let left = pcs;
  for (const m of db.mdccs.filter(x => x.soId === d.soId && x.lineId === d.lineId)) {
    const take = Math.min(left, m.pcs - m.usedPcs); if (take > 0) { m.usedPcs += take; left -= take; }
  }
  for (const p of packs) {
    post(db, { type: 'Dispatch', ref: no, itemId: p.itemId, lotOrHeat: p.no, stage: 'PACKED', status: 'Reserved', soId: d.soId, pcs: -p.pcs, kg: -p.netKg });
    p.state = 'Dispatched'; p.dispatchId = no;
  }
  db.dispatches.unshift({ id: uid('dc'), no, soId: d.soId, lineId: d.lineId, date: today(), packs: d.packNos, pcs, kg, vehicle: d.vehicle, transporter: d.transporter, lr: d.lr, ewayBill: d.ewayBill, mdccId: db.mdccs.find(m => m.soId === d.soId && m.lineId === d.lineId)?.id });
  if (o.status === 'In production' || o.status === 'Approved') o.status = 'Part dispatched';
  const all = o.lines.every(l => lineCounts(db, o.id, l.id).dispatched >= l.qtyPcs * (1 - o.tolerancePct / 100));
  if (all) o.status = 'Closed';
  log(db, 'dispatch', `${no} loaded: ${packs.length} packs, ${n(pcs)} pcs for ${o.no}`);
}

export const GST_PCT = 18;
export function invoiceDispatch(db: DB, dispatchId: string): Result {
  const dc = db.dispatches.find(x => x.id === dispatchId)!;
  if (db.invoices.some(i => i.dispatchId === dispatchId)) return err(`${dc.no} is already invoiced.`);
  const o = so(db, dc.soId); const ln = o.lines.find(x => x.id === dc.lineId)!;
  const c = lineCounts(db, o.id, ln.id);
  const cap = Math.floor(ln.qtyPcs * (1 + o.tolerancePct / 100)) - c.invoiced;
  if (dc.pcs > cap) return err(`Refused: invoicing ${dc.pcs} pcs would exceed the SO balance of ${cap} pcs.`);
  const taxable = Math.round(dc.pcs * ln.rate * 100) / 100;
  const gst = Math.round(taxable * GST_PCT) / 100;
  db.invoices.unshift({ id: uid('iv'), no: nextDoc(db, 'INV'), soId: o.id, lineId: ln.id, dispatchId, date: today(), pcs: dc.pcs, taxable, gst, total: Math.round(taxable + gst) });
  log(db, 'dispatch', `Invoice raised for ${dc.no} at SO rate ₹${ln.rate}/pc`);
}

/* ---------- maintenance & controls ---------- */
export function raiseBreakdown(db: DB, machineId: string, problem: string, raisedBy: string): Result {
  const m = machine(db, machineId);
  if (m.status === 'Breakdown') return err(`${m.code} already has an open breakdown ticket.`);
  if (!problem.trim()) return err('Describe the problem.');
  db.breakdowns.unshift({ id: uid('bd'), no: nextDoc(db, 'BD'), machineId, raisedBy, problem, stoppedAt: `${today()}T${new Date().toTimeString().slice(0, 5)}`, spares: [], status: 'Open' });
  m.status = 'Breakdown';
  const affected = db.workOrders.filter(w => w.machineId === machineId && (w.status === 'Released' || w.status === 'Running') && w.date >= today()).length;
  log(db, 'maintenance', `Breakdown on ${m.code}: ${problem}${affected ? `; ${affected} jobs flagged on the planning board` : ''}`);
}
export function restoreMachine(db: DB, bdId: string, work: string, minutes: number, spares: { name: string; qty: number; cost: number }[]): Result {
  const b = db.breakdowns.find(x => x.id === bdId)!;
  if (b.status === 'Restored') return err('Already restored.');
  if (!work.trim()) return err('Record the work done.');
  if (minutes <= 0) return err('Enter how long the machine was down.');
  const stopped = new Date(b.stoppedAt);
  b.restoredAt = new Date(stopped.getTime() + minutes * 60000).toISOString().slice(0, 16);
  b.work = work; b.spares = spares; b.status = 'Restored';
  machine(db, b.machineId).status = 'Idle';
  db.downtime.unshift({ id: uid('dt'), machineId: b.machineId, date: b.stoppedAt.slice(0, 10), shift: currentShift(), minutes, reason: 'Breakdown', note: b.problem });
  for (const s of spares) {
    const sp = db.items.find(i => i.code === 'SP-GEN')!;
    post(db, { type: 'Issue', ref: b.no, itemId: sp.id, lotOrHeat: s.name, stage: 'RM', status: 'Free', pcs: -s.qty, kg: 0 });
  }
  log(db, 'maintenance', `${machine(db, b.machineId).code} restored after ${minutes} min; downtime booked`);
}
export function completePm(db: DB, pmId: string): Result {
  const p = db.pm.find(x => x.id === pmId)!;
  p.lastDone = today();
  db.downtime.unshift({ id: uid('dt'), machineId: p.machineId, date: today(), shift: 'Day', minutes: p.hours * 60, reason: 'PM', note: p.task });
  log(db, 'maintenance', `PM done on ${machine(db, p.machineId).code}: ${p.task}`);
}
export function addDowntime(db: DB, d: { machineId: string; minutes: number; reason: DowntimeReason; note: string; shift: Shift }): Result {
  if (d.minutes <= 0) return err('Enter the minutes stopped.');
  db.downtime.unshift({ id: uid('dt'), date: today(), ...d });
  log(db, 'controls', `${d.minutes} min downtime on ${machine(db, d.machineId).code}: ${d.reason}`);
}
export function requestAdjustment(db: DB, d: { itemId: string; stage: Stage; status: StockStatus; lotOrHeat: string; soId?: string; kgDiff: number; pcsDiff: number; reason: string }): Result {
  if (!d.reason.trim()) return err('Every stock adjustment needs a reason.');
  if (!d.kgDiff && !d.pcsDiff) return err('Enter the difference found in the count.');
  const value = Math.abs(d.kgDiff) * (lastPrice(db, d.itemId) || 90);
  requestApproval(db, 'Stock adjustment', d.lotOrHeat, `${d.lotOrHeat}: ${d.kgDiff > 0 ? '+' : ''}${d.kgDiff} kg (${d.reason})`, value > LIMITS.adjustment ? 'Management' : 'Stores', value,
    { itemId: d.itemId, stage: d.stage, status: d.status, soId: d.soId, lotOrHeat: d.lotOrHeat, kg: d.kgDiff, pcs: d.pcsDiff });
  log(db, 'stock', `Count difference on ${d.lotOrHeat} sent for approval`);
}
