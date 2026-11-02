import { describe, it, expect } from 'vitest';
import {
  kgFromPcs, pcsFromKg, pcsFromMt, lotNumber, docNumber, maxYieldPcs, jobCardBalance, zincPickup, zincInBand,
  coatingPasses, weighbridgeVariance, landedPerKg, dispatchCap, oee, stockOf,
} from './plant';
import type { LedgerRow } from '../data/types';

describe('pieces and weight', () => {
  const m16 = { kgPer1000: 135 };
  it('converts pieces to kg and back', () => {
    expect(kgFromPcs(m16, 6000)).toBe(810);
    expect(pcsFromKg(m16, 810)).toBe(6000);
  });
  it('converts MT orders to pieces on entry', () => {
    expect(pcsFromMt(m16, 1.35)).toBe(10000);
  });
});

describe('numbering', () => {
  it('builds the lot number from plant, machine, date, shift and serial', () => {
    expect(lotNumber('AHD', 'HD-02', '2026-10-24', 'Day', 12)).toBe('AHD-HD02-261024-D-0012');
    expect(lotNumber('MUN', 'GI-11', '2026-10-24', 'Night', 3)).toBe('MUN-GI11-261024-N-0003');
  });
  it('numbers documents per plant, type and financial year', () => {
    expect(docNumber('AHD', 'SO', '2026-11-02', 1)).toBe('AHD/SO/26-27/0001');
    expect(docNumber('AHD', 'PO', '2027-03-31', 41)).toBe('AHD/PO/26-27/0041');
    expect(docNumber('AHD', 'PO', '2027-04-01', 1)).toBe('AHD/PO/27-28/0001');
  });
});

describe('production rules', () => {
  it('caps output at what the issued raw material can yield', () => {
    expect(maxYieldPcs(3440, 143)).toBe(24537);
  });
  it('closes a job card only when input = output + scrap + rejection within tolerance', () => {
    expect(jobCardBalance(3440, 3240, 191.9, 8.1).ok).toBe(true);
    const short = jobCardBalance(3440, 3240, 100, 8.1);
    expect(short.ok).toBe(false);
    expect(short.diffKg).toBeCloseTo(91.9, 3);
    expect(jobCardBalance(0, 0, 0, 0).ok).toBe(false);
  });
});

describe('galvanising', () => {
  it('calculates zinc pick-up from black and galvanised weight', () => {
    expect(zincPickup(1000, 1068)).toBe(6.8);
    expect(zincInBand(6.8)).toBe(true);
    expect(zincInBand(9.7)).toBe(false);
  });
  it('blocks coating below spec', () => {
    expect(coatingPasses(52, 64)).toBe(true);
    expect(coatingPasses(36, 55)).toBe(false);
    expect(coatingPasses(45, 47)).toBe(false);
  });
});

describe('inward, purchase and dispatch', () => {
  it('flags weighbridge variance against the invoice', () => {
    expect(weighbridgeVariance(7000, 23640, 16610)).toEqual({ net: 7030, diffKg: 30, pct: 0.4 });
  });
  it('compares quotes on landed cost', () => {
    expect(landedPerKg({ ratePerKg: 68.5, freightPerKg: 1.2 })).toBe(69.7);
  });
  it('caps dispatch at SO qty plus tolerance', () => {
    expect(dispatchCap(48000, 2, 0)).toBe(48960);
    expect(dispatchCap(48000, 2, 48900)).toBe(60);
    expect(dispatchCap(48000, 2, 49000)).toBe(0);
  });
});

describe('machines', () => {
  it('computes OEE as availability × performance × quality', () => {
    const r = oee(690, 69, 22356, 2400, 22000);
    expect(r.availability).toBeCloseTo(0.9, 3);
    expect(r.performance).toBeCloseTo(22356 / (2400 * 621 / 60), 3);
    expect(r.oee).toBeCloseTo(r.availability * r.performance * (22000 / 22356), 6);
  });
});

describe('stock ledger', () => {
  const row = (p: Partial<LedgerRow>): LedgerRow => ({ id: '', date: '', ts: 0, type: 'Receipt', plant: 'AHD', itemId: 'rm', ref: '', stage: 'RM', status: 'Free', lotOrHeat: 'H1', pcs: 0, kg: 0, user: '', ...p });
  it('derives stock from the movements', () => {
    const ledger = [row({ kg: 3520, status: 'Quality hold' }), row({ kg: -3520, status: 'Quality hold' }), row({ kg: 3520 }), row({ kg: -3440, type: 'Issue' })];
    expect(stockOf(ledger, { lotOrHeat: 'H1' }).kg).toBe(80);
    expect(stockOf(ledger, { status: 'Quality hold' }).kg).toBe(0);
  });
});
