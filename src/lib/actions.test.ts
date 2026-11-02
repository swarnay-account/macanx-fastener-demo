import { describe, it, expect } from 'vitest';
import { createSeed } from '../data/seed';
import * as A from './actions';
import { positions } from './inventory';
import { stockOf } from './plant';
import { traceBack, traceHeat } from './trace';
import type { DB } from '../data/types';

const fresh = () => createSeed();
const clone = (db: DB) => structuredClone(db);

describe('sample plant', () => {
  const db = fresh();

  it('plays four weeks of work through the plant rules', () => {
    expect(db.orders).toHaveLength(4);
    expect(db.lots.length).toBeGreaterThan(30);
    expect(db.packs.length).toBeGreaterThan(100);
    expect(db.invoices).toHaveLength(2);
  });

  it('never leaves a lot, heat or pack with negative stock', () => {
    const keys = new Set(db.ledger.map(r => `${r.lotOrHeat}|${r.stage}|${r.status}|${r.soId ?? ''}|${r.itemId}`));
    for (const k of keys) {
      const [lotOrHeat, stage, status, soId, itemId] = k.split('|');
      const s = stockOf(db.ledger, { lotOrHeat, stage: stage as never, status: status as never, soId, itemId });
      expect(s.kg, k).toBeGreaterThanOrEqual(-0.001);
    }
  });

  it('keeps every lot record in step with the ledger', () => {
    for (const l of db.lots) {
      const here = positions(db, l.no).filter(p => p.stage === l.stage);
      const total = here.reduce((s, p) => s + p.pcs, 0);
      expect(total === 0 || total === l.pcs, l.no).toBe(true);
    }
  });

  it('traces a dispatched pack back to the mill heat and GRN', () => {
    const pack = db.packs.find(p => p.state === 'Dispatched' && p.itemId === 'fg-hb1660')!;
    const t = traceBack(db, pack.no)!;
    expect(t.invoice).toBeTruthy();
    expect(t.heats.map(h => h.heatNo)).toContain('H-24187');
    expect(t.heats[0].grn?.no).toMatch(/GRN/);
  });

  it('traces a heat forward to the customers who received it', () => {
    const r = traceHeat(db, 'H-24187');
    expect(r.customers).toContain('Sahyadri Transmission Projects Ltd');
  });
});

describe('rules that refuse', () => {
  it('refuses to issue a heat that is on quality hold', () => {
    const db = clone(fresh());
    const wo = db.workOrders.find(w => w.operation === 'Heading' && w.itemId === 'fg-hb1240' && w.shift === 'Day')!;
    wo.status = 'Released';
    expect(A.issueHeat(db, wo.id, 'V-77180', 500)).toMatch(/quality hold/);
  });

  it('refuses a plain accept when the mill TC is outside the grade limits', () => {
    const db = clone(fresh());
    const grn = db.grns.find(g => g.qc === 'Quality hold' && g.lines[0].heatNo === 'V-77180')!;
    expect(A.qcDecision(db, grn.id, 'Accept')).toMatch(/Mn 0.94% outside/);
  });

  it('refuses a heat of the wrong grade for the BOM', () => {
    const db = clone(fresh());
    const wo = db.workOrders.find(w => w.operation === 'Heading' && w.itemId === 'fg-sb16175')!;
    expect(A.issueHeat(db, wo.id, 'H-24312', 100)).toMatch(/Grade mismatch/);
  });

  it('blocks output beyond what the issued material can yield', () => {
    const db = clone(fresh());
    const wo = db.workOrders.find(w => w.operation === 'Heading' && w.itemId === 'fg-sb16175')!;
    expect(A.recordOutput(db, wo.id, { pcs: 900, rejectPcs: 0, scrapKg: 0 })).toMatch(/Blocked/);
  });

  it('will not close a job card that does not balance', () => {
    const db = clone(fresh());
    const wo = db.workOrders.find(w => w.operation === 'Heading' && w.itemId === 'fg-sb16175')!;
    expect(A.closeJobCard(db, wo.id)).toMatch(/does not balance/);
  });

  it('refuses a GI batch above the kettle load limit', () => {
    const db = clone(fresh());
    const htLot = db.lots.find(l => l.stage === 'HT' && l.itemId === 'fg-hb2070')!;
    htLot.ipqc = 'Pass';
    db.machines.find(m => m.id === 'm-gi2')!.loadLimitKg = 500; // the lot is about 610 kg
    expect(A.createBatch(db, { kettleId: 'm-gi2', lotNos: [htLot.no], tempC: 450, dipSec: 70, spinSec: 18, prePass: true })).toMatch(/load limit/);
  });

  it('blocks a batch whose coating is below spec from going to packing', () => {
    const db = clone(fresh());
    const b = db.batches.find(x => x.status === 'In kettle')!;
    const r = A.postGi(db, b.id, { giKg: b.blackKg * 1.05, coatingMin: 35, coatingAvg: 44 }) as { failed: boolean; notice: string };
    expect(r.failed).toBe(true);
    expect(r.notice).toMatch(/Coating below spec/);
    expect(A.handoverBatch(db, b.id)).toMatch(/cannot go to packing/);
  });

  it('refuses dispatch beyond the MDCC balance', () => {
    const db = clone(fresh());
    const o = db.orders.find(x => x.clientPo === 'STPL/765KV/PO/1187')!;
    const ln = o.lines[0];
    const ready = db.packs.filter(p => p.lineId === ln.id && p.state === 'TPI accepted').map(p => p.no);
    expect(A.dispatchPacks(db, { soId: o.id, lineId: ln.id, packNos: ready, vehicle: 'GJ01 AA 1', transporter: 'T', lr: 'LR1', ewayBill: '' })).toMatch(/MDCC balance/);
  });

  it('asks for a reason before choosing a vendor who is not the lowest', () => {
    const db = clone(fresh());
    const r = db.rfqs.find(x => x.quotes.some(q => q.vendorId === 's2') && x.chosenVendorId === 's1' && db.approvals.some(a => a.ref === x.id))!;
    expect(A.choosePoVendor(db, r.id, 's1')).toMatch(/not the lowest landed cost/);
  });

  it('keeps an approval with the role it belongs to', () => {
    const db = clone(fresh());
    db.role = 'Operator';
    const a = db.approvals.find(x => x.state === 'Pending')!;
    expect(A.decide(db, a.id, true)).toMatch(/Only/);
  });
});
