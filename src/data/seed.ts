/**
 * Sample plant: WCCS Fastener Division, Ahmedabad. The last four weeks are played
 * through the same actions the screens use, so every number obeys the plant rules
 * and ties back to the stock ledger.
 */
import type { DB, Item, Machine, Party, Employee, Shift, Lot } from './types';
import { daysAgo, addDays, todayISO } from '../lib/format';
import { setClock, post } from '../lib/inventory';
import * as A from '../lib/actions';

export const DB_VERSION = 4;

function must<T>(r: T | string | undefined): T {
  if (typeof r === 'string') throw new Error(`Seed step refused: ${r}`);
  return r as T;
}

export function createSeed(): DB {
  const db: DB = {
    version: DB_VERSION, seededOn: todayISO(), plant: 'AHD', role: 'Management',
    items: ITEMS, grades: [
      { id: 'g1', name: '10B21', c: '0.18–0.23', mn: '0.70–1.00', b: '0.0005–0.003', tensile: '450–600' },
      { id: 'g2', name: 'SAE 1018', c: '0.15–0.20', mn: '0.60–0.90', tensile: '400–520' },
      { id: 'g3', name: 'EN8', c: '0.36–0.44', mn: '0.60–1.00', tensile: '550–700' },
      { id: 'g4', name: 'SAE 1010', c: '0.08–0.13', mn: '0.30–0.60', tensile: '330–450' },
    ],
    boms: [
      { itemId: 'fg-hb1660', rmItemId: 'rm-10b21-16', inputKgPer1000: 143, yieldPct: 94.4, scrapPct: 6 },
      { itemId: 'fg-hb2070', rmItemId: 'rm-10b21-20', inputKgPer1000: 260, yieldPct: 94.2, scrapPct: 6 },
      { itemId: 'fg-hb2480', rmItemId: 'rm-en8-24', inputKgPer1000: 435, yieldPct: 94.3, scrapPct: 6 },
      { itemId: 'fg-hb1240', rmItemId: 'rm-1018-12', inputKgPer1000: 56, yieldPct: 92.9, scrapPct: 7 },
      { itemId: 'fg-sb16175', rmItemId: 'rm-10b21-16', inputKgPer1000: 318, yieldPct: 94.3, scrapPct: 6 },
    ],
    machines: MACHINES.map(m => ({ ...m })), parties: PARTIES, employees: EMPLOYEES,
    orders: [], indents: [], rfqs: [], pos: [], grns: [], workOrders: [], lots: [], batches: [], packs: [], tpis: [], mdccs: [],
    dispatches: [], invoices: [], ledger: [], downtime: [], breakdowns: [], pm: [], roster: [], approvals: [], activity: [], counters: {},
  };

  // Daily roster: a named operator, in-charge and supervisor per machine and shift.
  const ops = db.employees.filter(e => e.role === 'Operator');
  for (const m of db.machines) for (const shift of ['Day', 'Night'] as Shift[]) {
    const skilled = ops.filter(o => o.skills.includes(m.type));
    const op = skilled[shift === 'Day' ? 0 : skilled.length > 1 ? 1 : 0] ?? ops[0];
    db.roster.push({ date: todayISO(), shift, machineId: m.id, operatorId: op.id, inchargeId: shift === 'Day' ? 'e8' : 'e9', supervisorId: 'e10' });
  }

  const at = (d: number, shift: Shift = 'Day') => setClock(daysAgo(d), shift);
  // Approves what the story has signed off; the non-lowest vendor choice stays waiting for management.
  const approveAll = () => { for (const a of db.approvals.filter(x => x.state === 'Pending' && x.kind !== 'Non-lowest vendor')) must(A.decide(db, a.id, true)); };

  /* Opening balances migrated from the old sheets. */
  at(30);
  const opening = (code: string, lotOrHeat: string, kg: number, pcs = 0) =>
    post(db, { type: 'Adjustment', ref: 'Opening', itemId: db.items.find(i => i.code === code)!.id, lotOrHeat, stage: 'RM', status: 'Free', pcs, kg });
  opening('CON-ZN', 'ZINC', 6200); opening('CON-FLX', 'FLUX', 420); opening('CON-ACD', 'ACID', 1300); opening('CON-BAG', 'BAGS', 0, 3200);
  opening('SP-GEN', 'Bearing 6205', 0, 24); opening('SP-GEN', 'Hydraulic hose 1/2"', 0, 8); opening('SP-GEN', 'Die insert M16', 0, 30);

  /* ---- SO 1: Sahyadri, 765 kV line. Made, bought, galvanised, inspected, part dispatched. ---- */
  at(17);
  const so1 = must(A.createSalesOrder(db, {
    customerId: 'c1', clientPo: 'STPL/765KV/PO/1187', poDate: daysAgo(19), project: '765 kV D/C Wardha–Raipur line', tpi: true, mdcc: true,
    tolerancePct: 2, packing: '25 kg HDPE bags, marked STPL/765KV',
    lines: [
      { boqText: 'Hex bolt M16 x 60, gr 8.8, HDG, with 1 nut', itemId: 'fg-hb1660', qtyPcs: 48000, rate: 14.8, due: addDays(todayISO(), 5), inhousePcs: 48000 },
      { boqText: 'Hex nut M16, cl 8, HDG', itemId: 'bo-hn16', qtyPcs: 48000, rate: 3.9, due: addDays(todayISO(), 5), inhousePcs: 0, boughtStage: 'Finished', splitReason: 'Nuts are not made in-house' },
      { boqText: 'Hex bolt M20 x 70, gr 8.8, HDG', itemId: 'fg-hb2070', qtyPcs: 20000, rate: 26.5, due: addDays(todayISO(), 12), inhousePcs: 20000 },
    ],
  }));
  approveAll();

  at(16);
  must(A.raiseIndent(db, { itemId: 'rm-10b21-16', qtyKg: 7000, needBy: daysAgo(12), department: 'Production', soId: so1.id, purpose: 'RM for M16 x 60 bolts' }));
  must(A.raiseIndent(db, { itemId: 'rm-10b21-20', qtyKg: 5400, needBy: daysAgo(6), department: 'Production', soId: so1.id, purpose: 'RM for M20 x 70 bolts' }));
  approveAll();
  for (const ind of [...db.indents].reverse()) {
    must(A.createRfq(db, ind.id, [
      { vendorId: 's1', ratePerKg: 68.5, freightPerKg: 1.2, gstPct: 18, days: 4, terms: '30 days' },
      { vendorId: 's2', ratePerKg: 67.9, freightPerKg: 2.6, gstPct: 18, days: 6, terms: '45 days' },
    ]));
    must(A.choosePoVendor(db, db.rfqs[0].id, 's1'));
  }
  must(A.createOutsourcePo(db, so1.id, so1.lines[1].id, 's3', 96));
  approveAll();
  const poRm16 = db.pos.find(p => p.lines[0].itemId === 'rm-10b21-16')!;
  const poRm20 = db.pos.find(p => p.lines[0].itemId === 'rm-10b21-20')!;
  const poNuts = db.pos.find(p => p.kind === 'Outsourced' && p.soId === so1.id)!;

  at(13);
  const g1 = must(A.receiveGrn(db, { poId: poRm16.id, vehicle: 'GJ03 AZ 4417', invoiceNo: 'SWR/2611/0442', ewayBill: '3412 8890 1172', invoiceKg: 7000, grossKg: 23640, tareKg: 16610,
    lines: [{ itemId: 'rm-10b21-16', heatNo: 'H-24187', coils: 2, kg: 3520 }, { itemId: 'rm-10b21-16', heatNo: 'H-24203', coils: 2, kg: 3510 }], tc: { c: 0.21, mn: 0.86, b: 0.0018, tensile: 512 } }));
  must(A.qcDecision(db, g1.grn.id, 'Accept'));
  const g2 = must(A.receiveGrn(db, { poId: poRm20.id, vehicle: 'GJ03 BW 2290', invoiceNo: 'SWR/2611/0450', ewayBill: '3412 8890 1209', invoiceKg: 5400, grossKg: 21980, tareKg: 16560,
    lines: [{ itemId: 'rm-10b21-20', heatNo: 'H-24311', coils: 2, kg: 2700 }, { itemId: 'rm-10b21-20', heatNo: 'H-24312', coils: 2, kg: 2710 }], tc: { c: 0.2, mn: 0.91, b: 0.0021, tensile: 534 } }));
  must(A.qcDecision(db, g2.grn.id, 'Accept'));

  // Two shifts of M16 x 60 through heading, threading and heat treatment.
  const l1 = so1.lines[0];
  at(12, 'Day'); must(A.planLine(db, so1.id, l1.id, 24000, daysAgo(12), 'Day'));
  at(12, 'Night'); must(A.planLine(db, so1.id, l1.id, 24000, daysAgo(12), 'Night'));
  const m16Lots: string[] = [];
  for (const [i, heat] of (['H-24187', 'H-24203'] as const).entries()) {
    const shift: Shift = i === 0 ? 'Day' : 'Night';
    const wos = db.workOrders.filter(w => w.lineId === l1.id && w.shift === shift);
    const [hd, th, ht] = ['Heading', 'Threading', 'Heat treatment'].map(op => wos.find(w => w.operation === op)!);
    at(12, shift);
    must(A.releaseWo(db, hd.id)); must(A.issueHeat(db, hd.id, heat, 3440));
    const forged: Lot[] = [];
    for (let k = 0; k < 4; k++) forged.push(must(A.recordOutput(db, hd.id, { pcs: 6000, rejectPcs: k === 2 ? 60 : 0, scrapKg: k < 3 ? 48 : 0 })));
    forged.forEach(l => must(A.ipqc(db, l.no, true)));
    topUpScrap(db, hd.id); must(A.closeJobCard(db, hd.id));
    at(11, shift); must(A.releaseWo(db, th.id));
    const threaded: Lot[] = [];
    for (const f of forged) { must(A.issueLot(db, th.id, f.no)); threaded.push(must(A.recordOutput(db, th.id, { pcs: 5985, rejectPcs: 15, scrapKg: 0 }))); }
    threaded.forEach(l => must(A.ipqc(db, l.no, true)));
    must(A.closeJobCard(db, th.id));
    at(10, shift); must(A.releaseWo(db, ht.id));
    for (const t of threaded) { must(A.issueLot(db, ht.id, t.no)); m16Lots.push(must(A.recordOutput(db, ht.id, { pcs: 5985, rejectPcs: 0, scrapKg: 0 })).no); }
    m16Lots.slice(-4).forEach(n => must(A.ipqc(db, n, true)));
    must(A.closeJobCard(db, ht.id));
  }

  // Bought nuts arrive finished and galvanised.
  at(9);
  const g3 = must(A.receiveGrn(db, { poId: poNuts.id, vehicle: 'GJ03 CK 7731', invoiceNo: 'RNW/1129', ewayBill: '3412 8891 0034', invoiceKg: 1680, grossKg: 9120, tareKg: 7436,
    lines: [{ itemId: 'bo-hn16', heatNo: 'RNW-B-5521', coils: 0, kg: 1680 }], tc: { c: 0.12, mn: 0.45, tensile: 420 } }));
  must(A.qcDecision(db, g3.grn.id, 'Accept'));

  // Galvanising, one lot per batch to stay inside the kettle limits.
  const kettles = ['m-gi1', 'm-gi2'];
  m16Lots.forEach((n, i) => {
    at(9 - Math.floor(i / 2), i % 2 ? 'Night' : 'Day');
    if (i === 7) { must(A.createBatch(db, { kettleId: 'm-gi1', lotNos: [n], tempC: 452, dipSec: 70, spinSec: 18, prePass: true })); return; } // still in the kettle
    must(A.createBatch(db, { kettleId: kettles[i % 2], lotNos: [n], tempC: 448 + (i % 3) * 3, dipSec: 65 + (i % 4) * 5, spinSec: 18, prePass: true }));
    const b = db.batches[0];
    const black = b.blackKg;
    if (i === 3) { A.postGi(db, b.id, { giKg: Math.round(black * 1.048), coatingMin: 36, coatingAvg: 47 }); } // fails, re-dipped below
    const pick = i === 5 ? 1.097 : 1.062 + (i % 3) * 0.006;
    must(A.postGi(db, b.id, { giKg: Math.round(black * pick), coatingMin: 52 + (i % 4) * 3, coatingAvg: 64 + (i % 5) * 3 }));
    must(A.handoverBatch(db, b.id));
  });

  // Packing, TPI, MDCC, dispatch and invoice.
  at(5);
  const galv = db.lots.filter(l => l.stage === 'GALV' && l.itemId === 'fg-hb1660').map(l => l.no);
  must(A.packLots(db, so1.id, l1.id, galv.slice(0, 6)));
  const nutLot = db.lots.find(l => l.itemId === 'bo-hn16')!.no;
  must(A.packLots(db, so1.id, so1.lines[1].id, [nutLot]));
  at(4, 'Day');
  const boltPacks = db.packs.filter(p => p.lineId === l1.id && p.state === 'Packed');
  const offered = boltPacks.filter(p => galv.slice(0, 4).includes(p.lots[0])).map(p => p.no);
  must(A.offerTpi(db, so1.id, l1.id, offered, 't1'));
  must(A.offerTpi(db, so1.id, so1.lines[1].id, db.packs.filter(p => p.lineId === so1.lines[1].id).map(p => p.no), 't1'));
  at(4, 'Night');
  must(A.recordTpi(db, db.tpis.find(t => t.lineId === l1.id)!.id, [offered[17]], 'WIS/IR/26/3381'));
  must(A.recordTpi(db, db.tpis.find(t => t.lineId === so1.lines[1].id)!.id, [], 'WIS/IR/26/3382'));
  at(3);
  must(A.requestMdcc(db, so1.id, l1.id, 20000, 'STPL/MDCC/0457'));
  must(A.requestMdcc(db, so1.id, so1.lines[1].id, 24000, 'STPL/MDCC/0458'));
  at(2);
  const accepted = db.packs.filter(p => p.lineId === l1.id && p.state === 'TPI accepted');
  let pcs = 0; const load: string[] = [];
  for (const p of accepted) { if (pcs + p.pcs > 18500) break; pcs += p.pcs; load.push(p.no); }
  must(A.dispatchPacks(db, { soId: so1.id, lineId: l1.id, packNos: load, vehicle: 'MH40 BG 6612', transporter: 'Shree Ganesh Roadlines', lr: 'SGR/88213', ewayBill: '3412 8893 5510' }));
  const nutPacks: string[] = []; let np = 0;
  for (const p of db.packs.filter(x => x.lineId === so1.lines[1].id && x.state === 'TPI accepted')) { if (np + p.pcs > 24000) break; np += p.pcs; nutPacks.push(p.no); }
  must(A.dispatchPacks(db, { soId: so1.id, lineId: so1.lines[1].id, packNos: nutPacks, vehicle: 'MH40 BG 6612', transporter: 'Shree Ganesh Roadlines', lr: 'SGR/88214', ewayBill: '3412 8893 5511' }));
  for (const d of [...db.dispatches].reverse()) must(A.invoiceDispatch(db, d.id));

  // M20 x 70: one shift through heading; part threaded; one threaded lot fails IPQC.
  const l3 = so1.lines[2];
  at(4); must(A.planLine(db, so1.id, l3.id, 10000, daysAgo(4), 'Day'));
  const [hd3, th3, ht3] = ['Heading', 'Threading', 'Heat treatment'].map(op => db.workOrders.find(w => w.lineId === l3.id && w.operation === op)!);
  must(A.releaseWo(db, hd3.id)); must(A.issueHeat(db, hd3.id, 'H-24311', 2640));
  const f3: Lot[] = [];
  for (let k = 0; k < 4; k++) f3.push(must(A.recordOutput(db, hd3.id, { pcs: 2500, rejectPcs: 0, scrapKg: 44 })));
  f3.forEach(l => must(A.ipqc(db, l.no, true)));
  topUpScrap(db, hd3.id); must(A.closeJobCard(db, hd3.id));
  at(3); must(A.releaseWo(db, th3.id));
  const t3: Lot[] = [];
  for (const f of f3.slice(0, 2)) { must(A.issueLot(db, th3.id, f.no)); t3.push(must(A.recordOutput(db, th3.id, { pcs: 2490, rejectPcs: 10, scrapKg: 0 }))); }
  must(A.ipqc(db, t3[0].no, true)); must(A.ipqc(db, t3[1].no, false, 'thread GO gauge tight on 3 of 20 samples'));
  at(2); must(A.releaseWo(db, ht3.id)); must(A.issueLot(db, ht3.id, t3[0].no)); must(A.recordOutput(db, ht3.id, { pcs: 2490, rejectPcs: 0, scrapKg: 0 }));

  /* ---- SO 2: Narmada. Part bought as black bolts, step bolts made from free stock. ---- */
  at(14);
  const so2 = must(A.createSalesOrder(db, {
    customerId: 'c2', clientPo: 'NGI/PO/2026/0773', poDate: daysAgo(15), project: '400 kV Dhuvaran–Kheda line', tpi: true, mdcc: false,
    tolerancePct: 2, packing: '50 kg wooden cases',
    lines: [
      { boqText: 'Bolt M24 x 80, 8.8, hot-dip galvanised', itemId: 'fg-hb2480', qtyPcs: 15000, rate: 44.5, due: addDays(todayISO(), 16), inhousePcs: 9000, boughtStage: 'Semi-finished', splitReason: 'HD-02 loaded till month end' },
      { boqText: 'Step bolt 16 dia x 175 with 2 nuts, HDG', itemId: 'fg-sb16175', qtyPcs: 6000, rate: 31, due: addDays(todayISO(), 10), inhousePcs: 6000 },
    ],
  }));
  approveAll();
  // Reorder stock of 16 mm wire rod (free stock, not for an order).
  must(A.raiseIndent(db, { itemId: 'rm-10b21-16', qtyKg: 6000, needBy: daysAgo(8), department: 'Stores', purpose: 'Below reorder level' }));
  approveAll();
  must(A.createRfq(db, db.indents[0].id, [
    { vendorId: 's1', ratePerKg: 68.2, freightPerKg: 1.2, gstPct: 18, days: 4, terms: '30 days' },
    { vendorId: 's2', ratePerKg: 68.0, freightPerKg: 2.6, gstPct: 18, days: 6, terms: '45 days' },
  ]));
  must(A.choosePoVendor(db, db.rfqs[0].id, 's1'));
  must(A.createOutsourcePo(db, so2.id, so2.lines[0].id, 's5', 88));
  approveAll();
  at(9);
  const poStock = db.pos.find(p => !p.soId && p.lines[0].itemId === 'rm-10b21-16')!;
  const g4 = must(A.receiveGrn(db, { poId: poStock.id, vehicle: 'GJ03 AZ 5102', invoiceNo: 'SWR/2611/0517', ewayBill: '3412 8892 2214', invoiceKg: 6000, grossKg: 22720, tareKg: 16690,
    lines: [{ itemId: 'rm-10b21-16', heatNo: 'H-24390', coils: 4, kg: 6030 }], tc: { c: 0.19, mn: 0.82, b: 0.0016, tensile: 498 } }));
  must(A.qcDecision(db, g4.grn.id, 'Accept'));

  // EN8 for the in-house M24 bolts: the planner picked a non-lowest vendor, waiting for management.
  at(8);
  must(A.raiseIndent(db, { itemId: 'rm-en8-24', qtyKg: 4100, needBy: addDays(todayISO(), 3), department: 'Production', soId: so2.id, purpose: 'RM for M24 x 80 (in-house 9,000 pcs)' }));
  approveAll();
  must(A.createRfq(db, db.indents[0].id, [
    { vendorId: 's2', ratePerKg: 71.4, freightPerKg: 2.4, gstPct: 18, days: 7, terms: '45 days' },
    { vendorId: 's1', ratePerKg: 72.6, freightPerKg: 1.3, gstPct: 18, days: 5, terms: '30 days' },
  ]));
  must(A.choosePoVendor(db, db.rfqs[0].id, 's1', 'Saurashtra TCs on EN8 have had no deviations this year; Vapi had two'));

  // Step bolts from the free 16 mm stock, running on the header today.
  at(1);
  const lsb = so2.lines[1];
  must(A.planLine(db, so2.id, lsb.id, 6000, daysAgo(0), 'Day'));
  const hdSb = db.workOrders.find(w => w.lineId === lsb.id && w.operation === 'Heading')!;
  setClock(todayISO(), 'Day');
  must(A.releaseWo(db, hdSb.id)); must(A.issueHeat(db, hdSb.id, 'H-24390', 1000));
  for (let k = 0; k < 2; k++) must(A.recordOutput(db, hdSb.id, { pcs: 1500, rejectPcs: 0, scrapKg: 20 }));

  // Bought black M24 bolts arrived; QC has not decided yet.
  at(1);
  const poBlack = db.pos.find(p => p.kind === 'Outsourced' && p.soId === so2.id)!;
  must(A.receiveGrn(db, { poId: poBlack.id, vehicle: 'GJ10 TT 9031', invoiceNo: 'JFP/26/2290', ewayBill: '3412 8894 0091', invoiceKg: 2460, grossKg: 10350, tareKg: 7865,
    lines: [{ itemId: 'fg-hb2480', heatNo: 'JFP-B-0391', coils: 0, kg: 2460 }], tc: { c: 0.4, mn: 0.78, tensile: 640 } }));

  /* ---- SO 3: Kutch Wind, planned for the next two days. ---- */
  at(5);
  const so3 = must(A.createSalesOrder(db, {
    customerId: 'c3', clientPo: 'KWT/WTG/PO/0412', poDate: daysAgo(6), project: 'Tower flange bolts, Bhuj wind park phase 2', tpi: false, mdcc: false,
    tolerancePct: 5, packing: '25 kg HDPE bags',
    lines: [{ boqText: 'Hex bolt M12 x 40, 5.6, HDG', itemId: 'fg-hb1240', qtyPcs: 40000, rate: 6.2, due: addDays(todayISO(), 9), inhousePcs: 40000 }],
  }));
  approveAll();
  must(A.raiseIndent(db, { itemId: 'rm-1018-12', qtyKg: 2300, needBy: addDays(todayISO(), 1), department: 'Production', soId: so3.id, purpose: 'RM for M12 x 40' }));
  approveAll();
  must(A.createRfq(db, db.indents[0].id, [
    { vendorId: 's2', ratePerKg: 66.1, freightPerKg: 2.2, gstPct: 18, days: 3, terms: '45 days' },
    { vendorId: 's1', ratePerKg: 67.4, freightPerKg: 1.2, gstPct: 18, days: 4, terms: '30 days' },
  ]));
  must(A.choosePoVendor(db, db.rfqs[0].id, 's2'));
  approveAll();
  setClock(todayISO(), 'Day');
  must(A.planLine(db, so3.id, so3.lines[0].id, 20000, addDays(todayISO(), 1), 'Day'));
  must(A.planLine(db, so3.id, so3.lines[0].id, 20000, addDays(todayISO(), 1), 'Night'));
  // RM arrived this morning; its TC shows Mn just above the 1018 range, so it waits for QC.
  const poM12 = db.pos.find(p => p.soId === so3.id)!;
  must(A.receiveGrn(db, { poId: poM12.id, vehicle: 'GJ15 AV 3307', invoiceNo: 'VSM/26/7718', ewayBill: '3412 8894 7720', invoiceKg: 2300, grossKg: 18920, tareKg: 16575,
    lines: [{ itemId: 'rm-1018-12', heatNo: 'V-77180', coils: 2, kg: 2345 }], tc: { c: 0.17, mn: 0.94, tensile: 488 } }));

  /* ---- SO 4: Deccan, entered yesterday, waiting for the sales head. ---- */
  at(1);
  must(A.createSalesOrder(db, {
    customerId: 'c4', clientPo: 'DPE/TL/PO/5521', poDate: daysAgo(2), project: '220 kV Shadnagar substation', tpi: true, mdcc: true,
    tolerancePct: 2, packing: '25 kg HDPE bags',
    lines: [{ boqText: 'HDG bolt M20 x 70, 8.8', itemId: 'fg-hb2070', qtyPcs: 10000, rate: 26.9, due: addDays(todayISO(), 25), inhousePcs: 10000 }],
  }));

  /* ---- Maintenance and downtime ---- */
  db.pm = [
    { id: 'pm1', machineId: 'm-hd1', task: 'Die block alignment, lubrication', everyDays: 30, lastDone: daysAgo(28), hours: 3 },
    { id: 'pm2', machineId: 'm-tr1', task: 'Roll die check, gearbox oil', everyDays: 30, lastDone: daysAgo(29), hours: 4 },
    { id: 'pm3', machineId: 'm-gi1', task: 'Kettle dross removal, burner check', everyDays: 15, lastDone: daysAgo(16), hours: 5 },
    { id: 'pm4', machineId: 'm-ht1', task: 'Belt inspection, thermocouple calibration', everyDays: 45, lastDone: daysAgo(10), hours: 6 },
    { id: 'pm5', machineId: 'm-wd1', task: 'Capstan bearing check', everyDays: 60, lastDone: daysAgo(58), hours: 2 },
    { id: 'pm6', machineId: 'm-hd2', task: 'Hydraulic oil change', everyDays: 90, lastDone: daysAgo(40), hours: 4 },
  ];
  at(9);
  must(A.raiseBreakdown(db, 'm-hd2', 'Hydraulic hose burst near clamp cylinder', 'e11'));
  must(A.restoreMachine(db, db.breakdowns[0].id, 'Hose replaced, system bled and tested', 140, [{ name: 'Hydraulic hose 1/2"', qty: 1, cost: 1850 }]));
  at(3);
  must(A.raiseBreakdown(db, 'm-tr1', 'Roll die cracked, thread profile out', 'e13'));
  must(A.restoreMachine(db, db.breakdowns[0].id, 'Roll die pair changed', 95, [{ name: 'Die insert M16', qty: 2, cost: 6400 }]));
  setClock(todayISO(), 'Day');
  must(A.raiseBreakdown(db, 'm-tr2', 'Feed chute jam, motor tripping on overload', 'e14'));
  const reasons = ['Die change', 'Die change', 'No material', 'No power', 'No operator', 'QC hold', 'Die change', 'No plan'] as const;
  const dtMachines = ['m-hd1', 'm-hd2', 'm-tr1', 'm-tr2', 'm-ht1', 'm-gi1'];
  for (let d = 13; d >= 1; d--) {
    at(d, d % 2 ? 'Day' : 'Night');
    for (let k = 0; k < 2; k++) {
      const reason = reasons[(d * 3 + k) % reasons.length];
      must(A.addDowntime(db, { machineId: dtMachines[(d + k * 2) % dtMachines.length], minutes: reason === 'Die change' ? 40 + (d % 3) * 15 : 25 + ((d + k) % 4) * 20, reason, note: '', shift: d % 2 ? 'Day' : 'Night' }));
    }
  }

  // Waiting in the approvals inbox: a stock count difference and the open ones above.
  setClock(todayISO(), 'Day');
  must(A.raiseIndent(db, { itemId: 'con-zn', qtyKg: 3000, needBy: addDays(todayISO(), 6), department: 'Galvanising', purpose: 'Zinc below reorder after this week’s batches' }));
  must(A.requestAdjustment(db, { itemId: 'con-zn', stage: 'RM', status: 'Free', lotOrHeat: 'ZINC', kgDiff: -38, pcsDiff: 0, reason: 'Monthly physical count of zinc ingots' }));

  setClock(null);
  db.machines.find(m => m.id === 'm-hd1')!.status = 'Running';
  db.activity.sort((a, b) => b.ts - a.ts);
  return db;
}

/** Books the remaining heading loss as scrap so the card balances (end cuts and flash). */
function topUpScrap(db: DB, woId: string) {
  const w = db.workOrders.find(x => x.id === woId)!;
  const input = w.issued.reduce((s, x) => s + x.kg, 0);
  const gap = Math.round((input - w.outputKg - w.scrapKg - w.rejectKg) * 1000) / 1000;
  if (gap > 0) {
    w.scrapKg = Math.round((w.scrapKg + gap) * 1000) / 1000;
    post(db, { type: 'Scrap', ref: w.no, itemId: 'scrap', lotOrHeat: 'SCRAP', stage: 'RM', status: 'Free', pcs: 0, kg: gap });
  }
}

const ITEMS: Item[] = [
  { id: 'rm-10b21-16', code: 'RM-10B21-16', name: 'Wire rod 10B21, 16 mm', type: 'Raw material', grade: '10B21', dia: 16, kgPer1000: 0, hsn: '7213', reorderKg: 8000, leadDays: 6, source: 'Buy' },
  { id: 'rm-10b21-20', code: 'RM-10B21-20', name: 'Wire rod 10B21, 20 mm', type: 'Raw material', grade: '10B21', dia: 20, kgPer1000: 0, hsn: '7213', reorderKg: 5000, leadDays: 6, source: 'Buy' },
  { id: 'rm-en8-24', code: 'RM-EN8-24', name: 'Round bar EN8, 24 mm', type: 'Raw material', grade: 'EN8', dia: 24, kgPer1000: 0, hsn: '7214', reorderKg: 4000, leadDays: 8, source: 'Buy' },
  { id: 'rm-1018-12', code: 'RM-1018-12', name: 'Wire rod SAE 1018, 12 mm', type: 'Raw material', grade: 'SAE 1018', dia: 12, kgPer1000: 0, hsn: '7213', reorderKg: 3000, leadDays: 4, source: 'Buy' },
  { id: 'fg-hb1660', code: 'HB-M16X60-88-HDG', name: 'Hex bolt M16×60, 8.8, HDG', type: 'Finished', product: 'Hex bolt', dia: 16, length: 60, propertyClass: '8.8', standard: 'ISO 4014', finish: 'HDG', kgPer1000: 135, hsn: '7318', leadDays: 6, source: 'Make' },
  { id: 'fg-hb2070', code: 'HB-M20X70-88-HDG', name: 'Hex bolt M20×70, 8.8, HDG', type: 'Finished', product: 'Hex bolt', dia: 20, length: 70, propertyClass: '8.8', standard: 'ISO 4014', finish: 'HDG', kgPer1000: 245, hsn: '7318', leadDays: 7, source: 'Make' },
  { id: 'fg-hb2480', code: 'HB-M24X80-88-HDG', name: 'Hex bolt M24×80, 8.8, HDG', type: 'Finished', product: 'Hex bolt', dia: 24, length: 80, propertyClass: '8.8', standard: 'ISO 4014', finish: 'HDG', kgPer1000: 410, hsn: '7318', leadDays: 8, source: 'Both' },
  { id: 'fg-hb1240', code: 'HB-M12X40-56-HDG', name: 'Hex bolt M12×40, 5.6, HDG', type: 'Finished', product: 'Hex bolt', dia: 12, length: 40, propertyClass: '5.6', standard: 'IS 12427', finish: 'HDG', kgPer1000: 52, hsn: '7318', leadDays: 5, source: 'Make' },
  { id: 'fg-sb16175', code: 'SB-M16X175-56-HDG', name: 'Step bolt M16×175, 5.6, HDG', type: 'Finished', product: 'Step bolt', dia: 16, length: 175, propertyClass: '5.6', standard: 'IS 10238', finish: 'HDG', kgPer1000: 300, hsn: '7318', leadDays: 7, source: 'Make' },
  { id: 'bo-hn16', code: 'HN-M16-8-HDG', name: 'Hex nut M16, cl 8, HDG', type: 'Bought-out', product: 'Hex nut', dia: 16, propertyClass: '8', standard: 'IS 1363', finish: 'HDG', kgPer1000: 35, hsn: '7318', leadDays: 10, source: 'Buy' },
  { id: 'bo-hn20', code: 'HN-M20-8-HDG', name: 'Hex nut M20, cl 8, HDG', type: 'Bought-out', product: 'Hex nut', dia: 20, propertyClass: '8', standard: 'IS 1363', finish: 'HDG', kgPer1000: 64, hsn: '7318', leadDays: 10, source: 'Buy' },
  { id: 'bo-wa16', code: 'WA-M16-HDG', name: 'Plain washer M16, HDG', type: 'Bought-out', product: 'Washer', dia: 16, standard: 'IS 2016', finish: 'HDG', kgPer1000: 11, hsn: '7318', leadDays: 10, source: 'Buy' },
  { id: 'con-zn', code: 'CON-ZN', name: 'Zinc ingot SHG 99.995%', type: 'Consumable', kgPer1000: 0, hsn: '7901', reorderKg: 3000, leadDays: 5, source: 'Buy' },
  { id: 'con-flx', code: 'CON-FLX', name: 'Flux, zinc ammonium chloride', type: 'Consumable', kgPer1000: 0, hsn: '2827', reorderKg: 200, leadDays: 5, source: 'Buy' },
  { id: 'con-acd', code: 'CON-ACD', name: 'Hydrochloric acid 33%', type: 'Consumable', kgPer1000: 0, hsn: '2806', reorderKg: 600, leadDays: 3, source: 'Buy' },
  { id: 'con-bag', code: 'CON-BAG', name: 'HDPE bag, 25 kg', type: 'Consumable', kgPer1000: 0, hsn: '3923', leadDays: 4, source: 'Buy' },
  { id: 'sp-gen', code: 'SP-GEN', name: 'Maintenance spares', type: 'Consumable', kgPer1000: 0, hsn: '8483', leadDays: 7, source: 'Buy' },
  { id: 'scrap', code: 'SCR-STEEL', name: 'Steel scrap (process and rejection)', type: 'Scrap', kgPer1000: 0, hsn: '7204', leadDays: 0, source: 'Make' },
];

const MACHINES: Machine[] = [
  { id: 'm-wd1', code: 'WD-01', name: 'Wire drawing 1', type: 'Wire drawing', plant: 'AHD', section: 'Wire', diaMin: 8, diaMax: 24, ratedPcsHr: 0, ratedKgHr: 900, status: 'Idle' },
  { id: 'm-hd1', code: 'HD-01', name: 'Bolt header M10–M20', type: 'Header', plant: 'AHD', section: 'Forging', diaMin: 10, diaMax: 20, ratedPcsHr: 2400, ratedKgHr: 0, status: 'Running' },
  { id: 'm-hd2', code: 'HD-02', name: 'Bolt header M20–M30', type: 'Header', plant: 'AHD', section: 'Forging', diaMin: 20, diaMax: 30, ratedPcsHr: 1300, ratedKgHr: 0, status: 'Idle' },
  { id: 'm-tr1', code: 'TR-01', name: 'Thread roller M10–M20', type: 'Thread roller', plant: 'AHD', section: 'Threading', diaMin: 10, diaMax: 20, ratedPcsHr: 3000, ratedKgHr: 0, status: 'Idle' },
  { id: 'm-tr2', code: 'TR-02', name: 'Thread roller M16–M30', type: 'Thread roller', plant: 'AHD', section: 'Threading', diaMin: 16, diaMax: 30, ratedPcsHr: 1800, ratedKgHr: 0, status: 'Idle' },
  { id: 'm-ht1', code: 'HT-01', name: 'Mesh-belt hardening & tempering', type: 'HT furnace', plant: 'AHD', section: 'Heat treatment', diaMin: 6, diaMax: 36, ratedPcsHr: 0, ratedKgHr: 450, status: 'Idle' },
  { id: 'm-gi1', code: 'GI-01', name: 'HDG kettle 1', type: 'GI kettle', plant: 'AHD', section: 'Galvanising', diaMin: 6, diaMax: 36, ratedPcsHr: 0, ratedKgHr: 1100, loadLimitKg: 1200, status: 'Running' },
  { id: 'm-gi2', code: 'GI-02', name: 'HDG kettle 2', type: 'GI kettle', plant: 'AHD', section: 'Galvanising', diaMin: 6, diaMax: 36, ratedPcsHr: 0, ratedKgHr: 800, loadLimitKg: 900, status: 'Idle' },
  { id: 'm-pk1', code: 'PK-01', name: 'Weigh-pack line', type: 'Packing', plant: 'AHD', section: 'Packing', diaMin: 6, diaMax: 36, ratedPcsHr: 0, ratedKgHr: 1500, status: 'Idle' },
  { id: 'm-hd11', code: 'HD-11', name: 'Bolt header M12–M24', type: 'Header', plant: 'MUN', section: 'Forging', diaMin: 12, diaMax: 24, ratedPcsHr: 1800, ratedKgHr: 0, status: 'Idle' },
  { id: 'm-tr11', code: 'TR-11', name: 'Thread roller M12–M24', type: 'Thread roller', plant: 'MUN', section: 'Threading', diaMin: 12, diaMax: 24, ratedPcsHr: 2200, ratedKgHr: 0, status: 'Idle' },
  { id: 'm-gi11', code: 'GI-11', name: 'HDG kettle, Mundra', type: 'GI kettle', plant: 'MUN', section: 'Galvanising', diaMin: 6, diaMax: 36, ratedPcsHr: 0, ratedKgHr: 900, loadLimitKg: 1000, status: 'Idle' },
];

const PARTIES: Party[] = [
  { id: 'c1', name: 'Sahyadri Transmission Projects Ltd', type: 'Customer', city: 'Pune', gstin: '27AAKCS4417M1Z2', terms: '60 days, LD 0.5% per week' },
  { id: 'c2', name: 'Narmada Grid Infra Pvt Ltd', type: 'Customer', city: 'Vadodara', gstin: '24AADCN2290Q1ZP', terms: '45 days' },
  { id: 'c3', name: 'Kutch Wind Towers LLP', type: 'Customer', city: 'Bhuj', gstin: '24AAOFK7731R1Z9', terms: '30 days' },
  { id: 'c4', name: 'Deccan Power EPC Ltd', type: 'Customer', city: 'Hyderabad', gstin: '36AACCD5521F1ZK', terms: '60 days' },
  { id: 's1', name: 'Saurashtra Wire Rods Pvt Ltd', type: 'Supplier', city: 'Rajkot', gstin: '24AAECS1187K1Z4', terms: '30 days', rating: 94 },
  { id: 's2', name: 'Vapi Steel Mills Ltd', type: 'Supplier', city: 'Vapi', gstin: '24AABCV3381D1ZQ', terms: '45 days', rating: 86 },
  { id: 's3', name: 'Rajkot Nut Works', type: 'Supplier', city: 'Rajkot', gstin: '24AAJFR5521B1Z7', terms: '30 days', rating: 91 },
  { id: 's4', name: 'Ahmedabad Zinc Traders', type: 'Supplier', city: 'Ahmedabad', gstin: '24AAGFA1129N1Z1', terms: 'Advance', rating: 89 },
  { id: 's5', name: 'Jamnagar Fasteners Pvt Ltd', type: 'Supplier', city: 'Jamnagar', gstin: '24AADCJ0391H1ZT', terms: '30 days', rating: 82 },
  { id: 'j1', name: 'Vatva Heat Treaters', type: 'Job worker', city: 'Ahmedabad', gstin: '24AAKFV2204L1Z3', terms: 'Monthly', rating: 88 },
  { id: 't1', name: 'Western Inspection Services', type: 'TPI agency', city: 'Mumbai', gstin: '27AAACW3381P1ZD', terms: 'Per visit' },
  { id: 't2', name: 'Kalinga Third-Party Inspection', type: 'TPI agency', city: 'Bhubaneswar', gstin: '21AAFCK8890G1Z5', terms: 'Per visit' },
];

const EMPLOYEES: Employee[] = [
  { id: 'e1', name: 'Nirav Desai', role: 'Admin', plant: 'AHD', skills: [] },
  { id: 'e2', name: 'Hemant Shah', role: 'Management', plant: 'AHD', skills: [] },
  { id: 'e3', name: 'Priya Iyer', role: 'Sales', plant: 'AHD', skills: [] },
  { id: 'e4', name: 'Jayesh Patel', role: 'Purchase', plant: 'AHD', skills: [] },
  { id: 'e5', name: 'Mukesh Solanki', role: 'Stores', plant: 'AHD', skills: [] },
  { id: 'e6', name: 'Anil Joshi', role: 'QC', plant: 'AHD', skills: [] },
  { id: 'e7', name: 'Ritesh Modi', role: 'Planner', plant: 'AHD', skills: [] },
  { id: 'e8', name: 'Sanjay Rathod', role: 'Prod. in-charge', plant: 'AHD', skills: [] },
  { id: 'e9', name: 'Mahesh Barot', role: 'Prod. in-charge', plant: 'AHD', skills: [] },
  { id: 'e10', name: 'Girish Pandya', role: 'Prod. in-charge', plant: 'AHD', skills: [] },
  { id: 'e11', name: 'Ramesh Vaghela', role: 'Operator', plant: 'AHD', skills: ['Header', 'Wire drawing'] },
  { id: 'e12', name: 'Kalpesh Parmar', role: 'Operator', plant: 'AHD', skills: ['Header'] },
  { id: 'e13', name: 'Dinesh Chauhan', role: 'Operator', plant: 'AHD', skills: ['Thread roller'] },
  { id: 'e14', name: 'Arjun Thakor', role: 'Operator', plant: 'AHD', skills: ['Thread roller'] },
  { id: 'e15', name: 'Bharat Makwana', role: 'Operator', plant: 'AHD', skills: ['HT furnace'] },
  { id: 'e16', name: 'Vikram Bhil', role: 'Operator', plant: 'AHD', skills: ['GI kettle', 'Packing'] },
  { id: 'e17', name: 'Paresh Prajapati', role: 'GI in-charge', plant: 'AHD', skills: ['GI kettle'] },
  { id: 'e18', name: 'Neha Trivedi', role: 'Dispatch', plant: 'AHD', skills: [] },
  { id: 'e19', name: 'Imran Shaikh', role: 'Maintenance', plant: 'AHD', skills: [] },
  { id: 'e20', name: 'Kiran Mehta', role: 'Accounts', plant: 'AHD', skills: [] },
  { id: 'e21', name: 'Suresh Gohil', role: 'Operator', plant: 'MUN', skills: ['Header', 'Thread roller'] },
];
