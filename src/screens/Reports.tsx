import { useEffect, useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useDB } from '../data/store';
import { PageHead } from '../components/shell';
import { Button, Panel, notify } from '../components/ui';
import { num, inr, niceDate, daysBetween, addDays } from '../lib/format';
import { STAGES, stageName, stockOf, zincPickup, zincInBand, weighbridgeVariance, round3 } from '../lib/plant';
import { item, machine, party, employee, lineCounts, shiftLoad, bomFor } from '../lib/actions';
import { lineProgress, soValue, planVsActual, scrapByMachine, downtimeByReason, oeeByMachine, pmStatus, stageStock, inPlant } from '../lib/metrics';
import { today } from '../lib/inventory';
import { printDoc } from '../lib/print';
import { takeFocus } from '../modules';
import type { DB } from '../data/types';

type Col = { key: string; label: string; right?: boolean };
type Out = { cols: Col[]; rows: Record<string, string | number>[]; note?: string };
type Report = { id: string; area: string; title: string; run: (db: DB) => Out };

const c = (key: string, label: string, right = false): Col => ({ key, label, right });
const soNo = (db: DB, id?: string) => db.orders.find(o => o.id === id)?.no ?? '—';
const pct = (a: number, b: number) => b ? `${(a / b * 100).toFixed(1)}%` : '—';

const AREAS: { area: string; measure: string; value: (db: DB) => string }[] = [
  { area: 'Sales', measure: 'On-time delivery', value: db => { const d = db.dispatches.map(x => { const l = db.orders.find(o => o.id === x.soId)!.lines.find(y => y.id === x.lineId)!; return x.date <= l.due; }); return d.length ? pct(d.filter(Boolean).length, d.length) : '—'; } },
  { area: 'Purchase', measure: 'Indent to PO, vendor on time', value: db => { const ds = db.pos.filter(p => p.indentIds.length).map(p => daysBetween(db.indents.find(i => i.id === p.indentIds[0])!.date, p.date)); const ot = db.pos.filter(p => p.status === 'Closed'); return `${ds.length ? (ds.reduce((s, x) => s + x, 0) / ds.length).toFixed(1) : '—'} days, ${pct(ot.length - db.grns.filter(g => g.date > (db.pos.find(p => p.id === g.poId)?.due ?? '')).length, ot.length || 1)}`; } },
  { area: 'Inward', measure: 'Incoming rejection', value: db => pct(db.grns.filter(g => g.qc === 'Rejected').length, db.grns.length) },
  { area: 'Planning', measure: 'Plan adherence', value: db => { const p = planVsActual(db, 30); const plan = p.reduce((s, x) => s + x.plan, 0); return pct(p.reduce((s, x) => s + Math.min(x.act, x.plan), 0), plan); } },
  { area: 'Production', measure: 'Scrap, yield', value: db => { const s = scrapByMachine(db); const i = s.reduce((a, x) => a + x.input, 0); const sc = s.reduce((a, x) => a + x.scrap, 0); return `${pct(sc, i)} scrap, ${pct(i - sc, i)} yield`; } },
  { area: 'Galvanising', measure: 'Zinc pick-up, first-pass yield', value: db => { const b = db.batches.filter(x => x.post === 'Pass'); const zp = b.length ? b.reduce((s, x) => s + zincPickup(x.blackKg, x.giKg), 0) / b.length : 0; return `${zp.toFixed(1)}%, ${pct(b.filter(x => !x.redips).length, b.length)}`; } },
  { area: 'Dispatch', measure: 'MDCC to dispatch', value: db => { const d = db.dispatches.filter(x => x.mdccId).map(x => daysBetween(db.mdccs.find(m => m.id === x.mdccId)!.date, x.date)); return d.length ? `${(d.reduce((s, x) => s + x, 0) / d.length).toFixed(1)} days` : '—'; } },
  { area: 'Inventory', measure: 'Inventory days', value: db => { const fg = stockOf(stageStock(db), {}).kg; const out = db.dispatches.reduce((s, d) => s + d.kg, 0) / 30; return out ? `${Math.round(fg / out)} days` : '—'; } },
  { area: 'Plant', measure: 'OEE, repair time', value: db => { const o = oeeByMachine(db).filter(x => x.shifts); const b = db.breakdowns.filter(x => x.restoredAt); const mttr = b.length ? b.reduce((s, x) => s + (new Date(x.restoredAt!).getTime() - new Date(x.stoppedAt).getTime()) / 60000, 0) / b.length : 0; return `${o.length ? Math.round(o.reduce((s, x) => s + x.oee, 0) / o.length * 100) : 0}% OEE, ${Math.round(mttr)} min MTTR`; } },
];

const REPORTS: Report[] = [
  { id: 'r1', area: 'Sales', title: 'SO register', run: db => ({ cols: [c('no', 'SO'), c('cust', 'Customer'), c('po', 'Client PO'), c('date', 'PO date'), c('val', 'Value', true), c('rev', 'Rev', true), c('st', 'Status')],
    rows: db.orders.map(o => ({ no: o.no, cust: party(db, o.customerId).name, po: o.clientPo, date: niceDate(o.poDate), val: inr(soValue(o)), rev: o.version, st: o.status })) }) },
  { id: 'r2', area: 'Sales', title: 'SO status, line and source-wise', run: db => ({ cols: [c('so', 'SO'), c('it', 'Item'), c('ord', 'Ordered', true), c('made', 'Made', true), c('bought', 'Bought', true), c('prod', 'Produced', true), c('galv', 'Galvanised', true), c('pack', 'Packed', true), c('mdcc', 'MDCC', true), c('dis', 'Dispatched', true), c('inv', 'Invoiced', true), c('bal', 'Balance', true)],
    rows: db.orders.flatMap(o => o.lines.map(l => { const p = lineProgress(db, o.id, l.id); const v = (lbl: string) => num(p.steps.find(s => s.label === lbl)!.value); return { so: o.no, it: p.item.name, ord: num(l.qtyPcs), made: num(l.inhousePcs), bought: num(l.qtyPcs - l.inhousePcs), prod: v('Produced / received'), galv: v('Galvanised'), pack: v('Packed'), mdcc: v('MDCC received'), dis: v('Dispatched'), inv: v('Invoiced'), bal: num(Math.max(0, p.balance)) }; })) }) },
  { id: 'r3', area: 'Sales', title: 'Pending dispatch', run: db => ({ cols: [c('so', 'SO'), c('cust', 'Customer'), c('it', 'Item'), c('due', 'Due'), c('bal', 'Balance pcs', true), c('kg', 'Balance kg', true), c('ready', 'Packed, not sent', true)],
    rows: db.orders.filter(o => !['Draft', 'Short-closed', 'Closed'].includes(o.status)).flatMap(o => o.lines.map(l => { const k = lineCounts(db, o.id, l.id); const bal = l.qtyPcs - k.dispatched; return { so: o.no, cust: party(db, o.customerId).name, it: item(db, l.itemId).name, due: niceDate(l.due), bal: num(bal), kg: num(bal * item(db, l.itemId).kgPer1000 / 1000), ready: num(k.packed - k.dispatched), _b: bal }; })).filter(r => (r._b as number) > 0) }) },
  { id: 'r4', area: 'Sales', title: 'Delivery performance', run: db => ({ cols: [c('dc', 'Dispatch'), c('so', 'SO'), c('due', 'Due'), c('sent', 'Sent'), c('days', 'Days early / late', true), c('st', 'On time')],
    rows: db.dispatches.map(d => { const l = db.orders.find(o => o.id === d.soId)!.lines.find(x => x.id === d.lineId)!; const late = daysBetween(l.due, d.date); return { dc: d.no, so: soNo(db, d.soId), due: niceDate(l.due), sent: niceDate(d.date), days: late, st: late <= 0 ? 'Yes' : 'No' }; }) }) },
  { id: 'r5', area: 'Sales', title: 'Order book by customer', run: db => ({ cols: [c('cust', 'Customer'), c('n', 'Open SOs', true), c('val', 'Order value', true), c('inv', 'Invoiced', true), c('bal', 'Balance value', true)],
    rows: db.parties.filter(p => p.type === 'Customer').map(p => { const os = db.orders.filter(o => o.customerId === p.id && o.status !== 'Short-closed'); const val = os.reduce((s, o) => s + soValue(o), 0); const inv = db.invoices.filter(i => os.some(o => o.id === i.soId)).reduce((s, i) => s + i.taxable, 0); return { cust: p.name, n: os.length, val: inr(val), inv: inr(inv), bal: inr(val - inv) }; }) }) },
  { id: 'r6', area: 'Purchase', title: 'Indent register', run: db => ({ cols: [c('no', 'Indent'), c('d', 'Date'), c('it', 'Item'), c('q', 'Qty kg', true), c('for', 'For'), c('st', 'Status')],
    rows: db.indents.map(i => ({ no: i.no, d: niceDate(i.date), it: item(db, i.itemId).name, q: num(i.qtyKg), for: i.soId ? soNo(db, i.soId) : `Stock (${i.department})`, st: i.status })) }) },
  { id: 'r7', area: 'Purchase', title: 'Pending indents', run: db => ({ cols: [c('no', 'Indent'), c('it', 'Item'), c('q', 'Qty kg', true), c('need', 'Need by'), c('age', 'Age, days', true), c('st', 'Waiting for')],
    rows: db.indents.filter(i => i.status === 'Pending' || i.status === 'Approved').map(i => ({ no: i.no, it: item(db, i.itemId).name, q: num(i.qtyKg), need: niceDate(i.needBy), age: daysBetween(i.date, today()), st: i.status === 'Pending' ? 'Approval' : db.rfqs.some(r => r.indentId === i.id) ? 'Vendor choice' : 'RFQ' })) }) },
  { id: 'r8', area: 'Purchase', title: 'PO register', run: db => ({ cols: [c('no', 'PO'), c('d', 'Date'), c('v', 'Vendor'), c('k', 'Type'), c('it', 'Item'), c('q', 'Qty kg', true), c('val', 'Value', true), c('st', 'Status')],
    rows: db.pos.map(p => ({ no: p.no, d: niceDate(p.date), v: party(db, p.vendorId).name, k: p.kind, it: item(db, p.lines[0].itemId).name, q: num(p.lines[0].qtyKg), val: inr(p.value), st: p.status })) }) },
  { id: 'r9', area: 'Purchase', title: 'Due and overdue POs', run: db => ({ cols: [c('no', 'PO'), c('v', 'Vendor'), c('it', 'Item'), c('bal', 'Balance kg', true), c('due', 'Due'), c('od', 'Days overdue', true)],
    rows: db.pos.filter(p => p.status === 'Open').map(p => ({ no: p.no, v: party(db, p.vendorId).name, it: item(db, p.lines[0].itemId).name, bal: num(p.lines[0].qtyKg - p.lines[0].receivedKg), due: niceDate(p.due), od: Math.max(0, daysBetween(p.due, today())) })),
    note: 'Open POs only; closed POs drop off this list.' }) },
  { id: 'r10', area: 'Purchase', title: 'Rate history', run: db => ({ cols: [c('it', 'Item'), c('d', 'Date'), c('v', 'Vendor'), c('r', '₹/kg', true), c('po', 'PO')],
    rows: db.pos.filter(p => p.kind === 'Material').map(p => ({ it: item(db, p.lines[0].itemId).name, d: niceDate(p.date), v: party(db, p.vendorId).name, r: p.lines[0].rate.toFixed(2), po: p.no })) }) },
  { id: 'r11', area: 'Purchase', title: 'Vendor rating', run: db => ({ cols: [c('v', 'Vendor'), c('pos', 'POs', true), c('val', 'Value', true), c('rej', 'GRNs rejected', true), c('wb', 'Avg weight diff', true), c('r', 'Rating', true)],
    rows: db.parties.filter(p => p.type === 'Supplier').map(p => { const gs = db.grns.filter(g => g.vendorId === p.id); return { v: p.name, pos: db.pos.filter(x => x.vendorId === p.id).length, val: inr(db.pos.filter(x => x.vendorId === p.id).reduce((s, x) => s + x.value, 0)), rej: gs.filter(g => g.qc === 'Rejected').length, wb: gs.length ? `${(gs.reduce((s, g) => s + weighbridgeVariance(g.invoiceKg, g.grossKg, g.tareKg).pct, 0) / gs.length).toFixed(1)}%` : '—', r: p.rating ?? '—' }; }) }) },
  { id: 'r12', area: 'Inward', title: 'GRN register', run: db => ({ cols: [c('no', 'GRN'), c('d', 'Date'), c('v', 'Vendor'), c('h', 'Heats'), c('kg', 'kg', true), c('qc', 'QC')],
    rows: db.grns.map(g => ({ no: g.no, d: niceDate(g.date), v: party(db, g.vendorId).name, h: g.lines.map(l => l.heatNo).join(', '), kg: num(g.lines.reduce((s, l) => s + l.kg, 0)), qc: g.qc })) }) },
  { id: 'r13', area: 'Inward', title: 'QC rejections', run: db => ({ cols: [c('where', 'Where'), c('ref', 'Reference'), c('what', 'What'), c('why', 'Reason')],
    rows: [...db.grns.filter(g => g.qc === 'Rejected').map(g => ({ where: 'Incoming', ref: g.no, what: g.lines.map(l => l.heatNo).join(', '), why: g.qcNote ?? '' })),
      ...db.lots.filter(l => l.ipqc === 'Fail').map(l => ({ where: 'In-process', ref: l.no, what: item(db, l.itemId).name, why: 'Failed IPQC, lot on hold' })),
      ...db.tpis.filter(t => t.rejectedPcs).map(t => ({ where: 'TPI', ref: t.no, what: `${num(t.rejectedPcs)} pcs`, why: `Report ${t.report}` }))] }) },
  { id: 'r14', area: 'Inward', title: 'Weight differences', run: db => ({ cols: [c('no', 'GRN'), c('inv', 'Invoice kg', true), c('net', 'Weighbridge net', true), c('diff', 'Difference', true), c('pct', '%', true)],
    rows: db.grns.map(g => { const w = weighbridgeVariance(g.invoiceKg, g.grossKg, g.tareKg); return { no: g.no, inv: num(g.invoiceKg), net: num(w.net), diff: num(w.diffKg), pct: `${w.pct}%` }; }) }) },
  { id: 'r15', area: 'Inward', title: 'Job work balance per vendor', run: db => ({ cols: [c('v', 'Job worker'), c('sent', 'kg sent', true), c('back', 'kg returned', true), c('loss', 'Process loss', true), c('bal', 'Balance with vendor', true)],
    rows: db.parties.filter(p => p.type === 'Job worker').map(p => { const ps = db.pos.filter(x => x.vendorId === p.id && x.kind === 'Job work'); const sent = ps.reduce((s, x) => s + x.lines[0].qtyKg, 0); const back = ps.reduce((s, x) => s + x.lines[0].receivedKg, 0); return { v: p.name, sent: num(sent), back: num(back), loss: '—', bal: num(sent - back) }; }),
    note: 'Heat treatment ran in-house this month; no material is out on job work.' }) },
  { id: 'r16', area: 'Planning', title: 'Machine-wise plan', run: db => ({ cols: [c('d', 'Date'), c('s', 'Shift'), c('m', 'Machine'), c('wo', 'Work order'), c('op', 'Operation'), c('it', 'Item'), c('t', 'Target pcs', true), c('st', 'Status')],
    rows: inPlant(db).workOrders.filter(w => w.date >= addDays(today(), -1)).sort((a, b) => a.date.localeCompare(b.date)).map(w => ({ d: niceDate(w.date), s: w.shift, m: machine(db, w.machineId).code, wo: w.no, op: w.operation, it: item(db, w.itemId).name, t: num(w.targetPcs), st: w.status })) }) },
  { id: 'r17', area: 'Planning', title: 'Load vs capacity', run: db => ({ cols: [c('m', 'Machine'), ...Array.from({ length: 4 }, (_, i) => c(`d${i}`, niceDate(addDays(today(), i - 1)).slice(0, 6), true))],
    rows: inPlant(db).machines.filter(m => ['Header', 'Thread roller', 'HT furnace'].includes(m.type)).map(m => { const r: Record<string, string> = { m: m.code }; for (let i = 0; i < 4; i++) { const d = addDays(today(), i - 1); const a = shiftLoad(db, m.id, d, 'Day'); const b = shiftLoad(db, m.id, d, 'Night'); r[`d${i}`] = `${round3(a.used + b.used)} / ${a.available + b.available} h`; } return r; }) }) },
  { id: 'r18', area: 'Planning', title: 'RM shortage', run: db => { const map = new Map<string, number>(); inPlant(db).workOrders.filter(w => w.operation === 'Heading' && w.status !== 'Closed' && w.status !== 'Running').forEach(w => { const b = bomFor(db, w.itemId)!; map.set(b.rmItemId, (map.get(b.rmItemId) ?? 0) + w.targetPcs * b.inputKgPer1000 / 1000); });
    return { cols: [c('rm', 'Raw material'), c('need', 'Needed', true), c('have', 'Usable stock', true), c('short', 'Short', true)], rows: [...map.entries()].map(([id, need]) => { const have = stockOf(db.ledger, { itemId: id, stage: 'RM', status: 'Free' }).kg + stockOf(db.ledger, { itemId: id, stage: 'RM', status: 'Reserved' }).kg; return { rm: item(db, id).name, need: num(need), have: num(have), short: num(Math.max(0, need - have)) }; }) }; } },
  { id: 'r19', area: 'Planning', title: 'Plan vs actual', run: db => ({ cols: [c('d', 'Date'), c('p', 'Planned pcs', true), c('a', 'Headed pcs', true), c('pct', 'Adherence', true)],
    rows: planVsActual(db, 14).map(d => ({ d: niceDate(d.date), p: num(d.plan), a: num(d.act), pct: d.plan ? pct(d.act, d.plan) : '—' })) }) },
  { id: 'r20', area: 'Production', title: 'Daily production MIS, shift and business line', run: db => { const map = new Map<string, { pcs: number; kg: number }>(); db.lots.filter(l => l.source === 'In-house' && l.stage !== 'GALV').forEach(l => { const k = `${l.date}|${l.shift}|${stageName(l.stage)}`; const e = map.get(k) ?? { pcs: 0, kg: 0 }; e.pcs += l.pcs; e.kg += l.kg; map.set(k, e); });
    return { cols: [c('d', 'Date'), c('s', 'Shift'), c('line', 'Business line / stage'), c('p', 'pcs', true), c('k', 'kg', true)], rows: [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, e]) => { const [d, s, line] = k.split('|'); return { d: niceDate(d), s, line: `Transmission bolts, ${line.toLowerCase()}`, p: num(e.pcs), k: num(e.kg) }; }) }; } },
  { id: 'r21', area: 'Production', title: 'Production by machine', run: db => ({ cols: [c('m', 'Machine'), c('cards', 'Job cards', true), c('p', 'Output pcs', true), c('k', 'Output kg', true), c('s', 'Scrap kg', true)],
    rows: inPlant(db).machines.filter(m => ['Header', 'Thread roller', 'HT furnace'].includes(m.type)).map(m => { const ws = db.workOrders.filter(w => w.machineId === m.id && w.outputPcs); return { m: m.code, cards: ws.length, p: num(ws.reduce((s, w) => s + w.outputPcs, 0)), k: num(ws.reduce((s, w) => s + w.outputKg, 0)), s: num(ws.reduce((s, w) => s + w.scrapKg, 0), 1) }; }) }) },
  { id: 'r22', area: 'Production', title: 'Production by operator', run: db => ({ cols: [c('o', 'Operator'), c('p', 'Output pcs', true), c('r', 'Rejection kg', true), c('s', 'Scrap kg', true)],
    rows: db.employees.filter(e => e.role === 'Operator').map(e => { const ws = db.workOrders.filter(w => w.operatorId === e.id); return { o: e.name, p: num(ws.reduce((s, w) => s + w.outputPcs, 0)), r: num(ws.reduce((s, w) => s + w.rejectKg, 0), 1), s: num(ws.reduce((s, w) => s + w.scrapKg, 0), 1) }; }) }) },
  { id: 'r23', area: 'Production', title: 'Job card status', run: db => ({ cols: [c('wo', 'Job card'), c('m', 'Machine'), c('op', 'Operation'), c('t', 'Target', true), c('o', 'Done', true), c('st', 'Status')],
    rows: inPlant(db).workOrders.map(w => ({ wo: w.no, m: machine(db, w.machineId).code, op: w.operation, t: num(w.targetPcs), o: num(w.outputPcs), st: w.status })) }) },
  { id: 'r24', area: 'Production', title: 'Scrap in kg and %', run: db => ({ cols: [c('m', 'Machine'), c('in', 'Input kg', true), c('s', 'Scrap + rejection kg', true), c('pct', 'Scrap %', true)],
    rows: scrapByMachine(db).map(s => ({ m: `${s.machine.code} ${s.machine.name}`, in: num(s.input), s: num(s.scrap, 1), pct: pct(s.scrap, s.input) })) }) },
  { id: 'r25', area: 'Galvanising', title: 'Daily HDG MIS per kettle', run: db => { const map = new Map<string, { n: number; black: number; gi: number; zinc: number }>(); db.batches.filter(b => b.post === 'Pass').forEach(b => { const k = `${b.date}|${machine(db, b.kettleId).code}`; const e = map.get(k) ?? { n: 0, black: 0, gi: 0, zinc: 0 }; e.n++; e.black += b.blackKg; e.gi += b.giKg; e.zinc += b.zincKg; map.set(k, e); });
    return { cols: [c('d', 'Date'), c('k', 'Kettle'), c('n', 'Batches', true), c('b', 'Black kg', true), c('g', 'GI kg', true), c('z', 'Zinc issued kg', true), c('p', 'Pick-up', true)], rows: [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, e]) => { const [d, kt] = k.split('|'); return { d: niceDate(d), k: kt, n: e.n, b: num(e.black), g: num(e.gi), z: num(e.zinc, 1), p: `${zincPickup(e.black, e.gi)}%` }; }) }; } },
  { id: 'r26', area: 'Galvanising', title: 'GI batch register', run: db => ({ cols: [c('no', 'Batch'), c('d', 'Date'), c('k', 'Kettle'), c('l', 'Lots'), c('b', 'Black kg', true), c('g', 'GI kg', true), c('st', 'Status')],
    rows: db.batches.map(b => ({ no: b.no, d: niceDate(b.date), k: machine(db, b.kettleId).code, l: b.lots.join(', '), b: num(b.blackKg), g: b.giKg ? num(b.giKg) : '—', st: b.status })) }) },
  { id: 'r27', area: 'Galvanising', title: 'Zinc pick-up', run: db => ({ cols: [c('no', 'Batch'), c('b', 'Black kg', true), c('g', 'GI kg', true), c('p', 'Pick-up', true), c('band', 'Band 5–9%')],
    rows: db.batches.filter(b => b.giKg).map(b => { const p = zincPickup(b.blackKg, b.giKg); return { no: b.no, b: num(b.blackKg), g: num(b.giKg), p: `${p}%`, band: zincInBand(p) ? 'Inside' : 'Outside: alert' }; }) }) },
  { id: 'r28', area: 'Galvanising', title: 'Coating thickness', run: db => ({ cols: [c('no', 'Batch'), c('min', 'Local min µm', true), c('avg', 'Average µm', true), c('r', 'Result')],
    rows: db.batches.filter(b => b.coatingAvg).map(b => ({ no: b.no, min: b.coatingMin, avg: b.coatingAvg, r: b.post === 'Pass' ? 'Pass' : 'Fail: re-dip' })), note: 'Spec: 40 µm local minimum, 50 µm average (ISO 10684 / IS 1367-13).' }) },
  { id: 'r29', area: 'Galvanising', title: 'Re-galvanising', run: db => ({ cols: [c('no', 'Batch'), c('k', 'Kettle'), c('n', 'Re-dips', true), c('st', 'Final status')],
    rows: db.batches.filter(b => b.redips).map(b => ({ no: b.no, k: machine(db, b.kettleId).code, n: b.redips ?? 0, st: b.status })) }) },
  { id: 'r30', area: 'Dispatch', title: 'Packing list', run: db => ({ cols: [c('so', 'SO'), c('pk', 'Pack'), c('it', 'Item'), c('lot', 'Lot'), c('p', 'pcs', true), c('n', 'Net kg', true), c('g', 'Gross kg', true)],
    rows: db.packs.slice(0, 120).map(p => ({ so: soNo(db, p.soId), pk: p.no, it: item(db, p.itemId).name, lot: p.lots.join(', '), p: num(p.pcs), n: num(p.netKg, 2), g: num(p.grossKg, 2) })), note: 'First 120 packs; the full list prints per SO.' }) },
  { id: 'r31', area: 'Dispatch', title: 'TPI status', run: db => ({ cols: [c('no', 'Call'), c('so', 'SO'), c('a', 'Agency'), c('o', 'Offered', true), c('ac', 'Accepted', true), c('rj', 'Rejected', true), c('st', 'Status')],
    rows: db.tpis.map(t => ({ no: t.no, so: soNo(db, t.soId), a: party(db, t.agencyId).name, o: num(t.offeredPcs), ac: num(t.acceptedPcs), rj: num(t.rejectedPcs), st: t.status === 'Done' ? `Report ${t.report}` : 'Awaiting' })) }) },
  { id: 'r32', area: 'Dispatch', title: 'MDCC register', run: db => ({ cols: [c('no', 'MDCC'), c('so', 'SO'), c('d', 'Date'), c('v', 'Valid till'), c('q', 'Cleared', true), c('u', 'Used', true), c('b', 'Balance', true)],
    rows: db.mdccs.map(m => ({ no: m.no, so: soNo(db, m.soId), d: niceDate(m.date), v: niceDate(m.validTill), q: num(m.pcs), u: num(m.usedPcs), b: num(m.pcs - m.usedPcs) })) }) },
  { id: 'r33', area: 'Dispatch', title: 'Dispatch register', run: db => ({ cols: [c('no', 'Challan'), c('d', 'Date'), c('so', 'SO'), c('v', 'Vehicle'), c('lr', 'LR'), c('p', 'pcs', true), c('k', 'kg', true)],
    rows: db.dispatches.map(d => ({ no: d.no, d: niceDate(d.date), so: soNo(db, d.soId), v: d.vehicle, lr: d.lr, p: num(d.pcs), k: num(d.kg) })) }) },
  { id: 'r34', area: 'Dispatch', title: 'Invoice register', run: db => ({ cols: [c('no', 'Invoice'), c('d', 'Date'), c('so', 'SO'), c('p', 'pcs', true), c('t', 'Taxable', true), c('g', 'GST', true), c('tot', 'Total', true)],
    rows: db.invoices.map(i => ({ no: i.no, d: niceDate(i.date), so: soNo(db, i.soId), p: num(i.pcs), t: inr(i.taxable), g: inr(i.gst), tot: inr(i.total) })) }) },
  { id: 'r35', area: 'Inventory', title: 'Stage-wise stock', run: db => { const led = stageStock(db); const items = [...new Set(led.map(r => r.itemId))];
    return { cols: [c('it', 'Item'), ...STAGES.map(s => c(s.id, s.name, true))], rows: items.map(id => { const r: Record<string, string> = { it: item(db, id).name }; STAGES.forEach(s => { const k = stockOf(led, { itemId: id, stage: s.id }).kg; r[s.id] = k > 0.5 ? num(k) : '—'; }); return r; }), note: 'kg at each stage' }; } },
  { id: 'r36', area: 'Inventory', title: 'Stock ageing', run: db => { const buckets = [['0–7 days', 0, 7], ['8–15 days', 8, 15], ['16–30 days', 16, 30], ['Over 30 days', 31, 9999]] as const; const pos = new Map<string, { kg: number; date: string }>(); stageStock(db).forEach(r => { const k = `${r.lotOrHeat}|${r.stage}`; const e = pos.get(k) ?? { kg: 0, date: r.date }; e.kg += r.kg; if (r.kg > 0) e.date = r.date; pos.set(k, e); });
    return { cols: [c('b', 'Age'), c('n', 'Positions', true), c('k', 'kg', true)], rows: buckets.map(([label, a, b]) => { const ps = [...pos.values()].filter(p => p.kg > 0.5 && daysBetween(p.date, today()) >= a && daysBetween(p.date, today()) <= b); return { b: label, n: ps.length, k: num(ps.reduce((s, p) => s + p.kg, 0)) }; }) }; } },
  { id: 'r37', area: 'Inventory', title: 'SO-reserved stock', run: db => ({ cols: [c('so', 'SO'), ...STAGES.map(s => c(s.id, s.name, true))],
    rows: db.orders.map(o => { const r: Record<string, string> = { so: o.no }; STAGES.forEach(s => { const k = stockOf(stageStock(db), { soId: o.id, stage: s.id, status: 'Reserved' }).kg; r[s.id] = k > 0.5 ? num(k) : '—'; }); return r; }), note: 'kg reserved for each order at each stage' }) },
  { id: 'r38', area: 'Inventory', title: 'Slow-moving items', run: db => ({ cols: [c('it', 'Item'), c('k', 'Stock kg', true), c('last', 'Last movement'), c('days', 'Days idle', true)],
    rows: db.items.map(i => { const rows = db.ledger.filter(r => r.itemId === i.id); const k = stockOf(rows, {}).kg; const last = rows.map(r => r.date).sort().pop(); return { it: i.name, k, last: last ? niceDate(last) : '—', days: last ? daysBetween(last, today()) : 0 }; }).filter(r => r.k > 1 && r.days >= 7).map(r => ({ ...r, k: num(r.k) })) }) },
  { id: 'r39', area: 'Inventory', title: 'Stock ledger', run: db => ({ cols: [c('d', 'Date'), c('t', 'Movement'), c('ref', 'Document'), c('lot', 'Lot / heat'), c('st', 'Stage'), c('s', 'Status'), c('k', 'kg', true)],
    rows: [...db.ledger].reverse().slice(0, 100).map(r => ({ d: niceDate(r.date), t: r.type, ref: r.ref, lot: r.lotOrHeat, st: stageName(r.stage), s: r.status, k: num(r.kg, 1) })), note: 'Latest 100 movements' }) },
  { id: 'r40', area: 'Plant', title: 'Downtime by reason', run: db => ({ cols: [c('r', 'Reason'), c('m', 'Minutes', true), c('h', 'Hours', true)], rows: downtimeByReason(db).map(d => ({ r: d.reason, m: num(d.minutes), h: (d.minutes / 60).toFixed(1) })) }) },
  { id: 'r41', area: 'Plant', title: 'Breakdown log', run: db => ({ cols: [c('no', 'Ticket'), c('m', 'Machine'), c('p', 'Problem'), c('by', 'Raised by'), c('t', 'Down for', true), c('w', 'Work done')],
    rows: db.breakdowns.map(b => ({ no: b.no, m: machine(db, b.machineId).code, p: b.problem, by: employee(db, b.raisedBy)?.name ?? '', t: b.restoredAt ? `${Math.round((new Date(b.restoredAt).getTime() - new Date(b.stoppedAt).getTime()) / 60000)} min` : 'Open', w: b.work ?? '' })) }) },
  { id: 'r42', area: 'Plant', title: 'PM compliance', run: db => ({ cols: [c('m', 'Machine'), c('t', 'Task'), c('l', 'Last done'), c('d', 'Due'), c('s', 'State')], rows: pmStatus(db).map(p => ({ m: machine(db, p.pm.machineId).code, t: p.pm.task, l: niceDate(p.pm.lastDone), d: niceDate(p.due), s: p.state })) }) },
  { id: 'r43', area: 'Plant', title: 'OEE by machine', run: db => ({ cols: [c('m', 'Machine'), c('a', 'Availability', true), c('p', 'Performance', true), c('q', 'Quality', true), c('o', 'OEE', true)],
    rows: oeeByMachine(db).filter(r => r.shifts).map(r => ({ m: r.machine.code, a: pct(r.availability, 1), p: pct(r.performance, 1), q: pct(r.quality, 1), o: pct(r.oee, 1) })) }) },
];

export function Reports() {
  const db = useDB();
  const [active, setActive] = useState('r2');
  useEffect(() => { const f = takeFocus(); if (f && REPORTS.some(r => r.id === f)) setActive(f); }, []);
  const report = REPORTS.find(r => r.id === active)!;
  const out = useMemo(() => report.run(db), [report, db]);
  const area = AREAS.find(a => a.area === report.area)!;
  const table = (
    <table className="table">
      <thead><tr>{out.cols.map(col => <th key={col.key} style={{ textAlign: col.right ? 'right' : undefined }}>{col.label}</th>)}</tr></thead>
      <tbody>
        {out.rows.map((r, i) => <tr key={i}>{out.cols.map(col => <td key={col.key} style={{ textAlign: col.right ? 'right' : undefined }}>{r[col.key]}</td>)}</tr>)}
        {out.rows.length === 0 && <tr><td colSpan={out.cols.length} className="muted">Nothing to show.</td></tr>}
      </tbody>
    </table>
  );
  return (
    <>
      <PageHead title="Reports" sub="All 43 reports from the scope, built only from ERP transactions. Every report filters by plant, date, shift, SO and item in the full system." />
      <div className="reports">
        <nav className="reports__nav" aria-label="Reports">
          {AREAS.map(a => (
            <div key={a.area}>
              <h4>{a.area}<small>{REPORTS.filter(r => r.area === a.area).length}</small></h4>
              {REPORTS.filter(r => r.area === a.area).map(r => (
                <button key={r.id} className={r.id === active ? 'is-active' : ''} onClick={() => setActive(r.id)}><b>{r.id.slice(1)}.</b><span>{r.title}</span></button>
              ))}
            </div>
          ))}
        </nav>
        <Panel title={`${report.id.slice(1)}. ${report.title}`} action={<div className="row">
          <Button small variant="ghost" icon={<Download size={14} />} onClick={() => notify('Excel and PDF export are part of the delivered system.', 'info')}>Export</Button>
          <Button small variant="ghost" icon={<Printer size={14} />} onClick={() => printDoc(<div className="doc"><h2>{report.title}</h2><p>WCCS Fastener Division, {niceDate(today())}</p>{table}</div>)}>Print</Button>
        </div>}>
          <div className="calc-strip" style={{ marginBottom: 12 }}><span>{report.area} key measure: {area.measure}<strong>{area.value(db)}</strong></span><span>{out.rows.length} rows</span></div>
          {out.note && <p className="muted small" style={{ marginBottom: 8 }}>{out.note}</p>}
          <div className="table-scroll">{table}</div>
        </Panel>
      </div>
    </>
  );
}

