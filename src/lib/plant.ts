/**
 * Plant arithmetic. Pure functions only, so every rule here is covered by plant.test.ts.
 */
import type { Item, Stage, Shift, Plant, LedgerRow, StockStatus } from '../data/types';

export const STAGES: { id: Stage; name: string; unit: string }[] = [
  { id: 'RM', name: 'Raw material', unit: 'kg, coils' },
  { id: 'DRAWN', name: 'Drawn wire', unit: 'kg' },
  { id: 'FORGED', name: 'Headed blanks', unit: 'pcs, kg' },
  { id: 'THREADED', name: 'Threaded (black)', unit: 'pcs, kg' },
  { id: 'HT', name: 'Heat treated', unit: 'pcs, kg' },
  { id: 'GALV', name: 'Galvanised', unit: 'pcs, kg' },
  { id: 'PACKED', name: 'Packed', unit: 'packs, pcs, kg' },
];
export const stageName = (s: Stage) => STAGES.find(x => x.id === s)!.name;
export const stageIndex = (s: Stage) => STAGES.findIndex(x => x.id === s);

/* ---------- pieces and weight ---------- */
export const kgFromPcs = (item: Pick<Item, 'kgPer1000'>, pcs: number) => round3(pcs * item.kgPer1000 / 1000);
export const pcsFromKg = (item: Pick<Item, 'kgPer1000'>, kg: number) => item.kgPer1000 > 0 ? Math.floor(kg * 1000 / item.kgPer1000) : 0;
/** Orders received in MT are converted to pieces on entry. */
export const pcsFromMt = (item: Pick<Item, 'kgPer1000'>, mt: number) => pcsFromKg(item, mt * 1000);
export const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const round1 = (n: number) => Math.round(n * 10) / 10;

/* ---------- lot numbers ---------- */
/** AHD-HD02-261024-D-0012: plant, machine, date (yymmdd), shift, serial. */
export function lotNumber(plant: Plant, machineCode: string, isoDate: string, shift: Shift, serial: number) {
  const [y, m, d] = isoDate.split('-');
  return `${plant}-${machineCode.replace('-', '')}-${y.slice(2)}${m}${d}-${shift === 'Day' ? 'D' : 'N'}-${String(serial).padStart(4, '0')}`;
}
/** Document numbers per plant, type and financial year: AHD/SO/26-27/0001. */
export function docNumber(plant: Plant, type: string, isoDate: string, serial: number) {
  const [y, m] = isoDate.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${plant}/${type}/${String(start).slice(2)}-${String(start + 1).slice(2)}/${String(serial).padStart(4, '0')}`;
}

/* ---------- production rules ---------- */
/**
 * The most pieces the issued raw material can yield. The BOM's input kg per 1000
 * already carries the expected loss; 2% allowance covers coil-to-coil variation.
 * Output above this is blocked.
 */
export function maxYieldPcs(issuedKg: number, inputKgPer1000: number, allowancePct = 2) {
  return Math.floor(issuedKg * 1000 / inputKgPer1000 * (1 + allowancePct / 100));
}
/** A job card closes only when input kg = output + scrap + rejection, within tolerance. */
export function jobCardBalance(inputKg: number, outputKg: number, scrapKg: number, rejectKg: number, tolerancePct = 1.5) {
  const accounted = outputKg + scrapKg + rejectKg;
  const diffKg = round3(inputKg - accounted);
  const diffPct = inputKg > 0 ? Math.abs(diffKg) / inputKg * 100 : 0;
  return { accounted: round3(accounted), diffKg, diffPct: round1(diffPct), ok: inputKg > 0 && diffPct <= tolerancePct };
}
export const scrapPct = (scrapKg: number, inputKg: number) => inputKg > 0 ? round1(scrapKg / inputKg * 100) : 0;

/* ---------- galvanising ---------- */
/** Zinc pick-up % = (galvanised wt − black wt) / black wt × 100. */
export const zincPickup = (blackKg: number, giKg: number) => blackKg > 0 ? round1((giKg - blackKg) / blackKg * 100) : 0;
export const ZINC_BAND = { min: 5, max: 9 };
export const zincInBand = (pct: number) => pct >= ZINC_BAND.min && pct <= ZINC_BAND.max;
/** Coating per ISO 10684 / IS 1367-13 for HDG fasteners: local minimum and batch average, microns. */
export const COATING_SPEC = { min: 40, avg: 50 };
export const coatingPasses = (min: number, avg: number) => min >= COATING_SPEC.min && avg >= COATING_SPEC.avg;

/* ---------- inward ---------- */
export function weighbridgeVariance(invoiceKg: number, grossKg: number, tareKg: number) {
  const net = round3(grossKg - tareKg);
  const pct = invoiceKg > 0 ? round1((net - invoiceKg) / invoiceKg * 100) : 0;
  return { net, diffKg: round3(net - invoiceKg), pct };
}
export const landedPerKg = (q: { ratePerKg: number; freightPerKg: number }) => round3(q.ratePerKg + q.freightPerKg);

/* ---------- dispatch ---------- */
/** The most pieces that may still go out on a line: SO qty plus tolerance, less what has gone. */
export function dispatchCap(orderPcs: number, tolerancePct: number, dispatchedPcs: number) {
  return Math.max(0, Math.floor(orderPcs * (1 + tolerancePct / 100)) - dispatchedPcs);
}

/* ---------- machines ---------- */
export const SHIFT_HOURS = 11.5;
/** OEE = availability × performance × quality. */
export function oee(plannedMin: number, downMin: number, actualPcs: number, ratedPcsHr: number, goodPcs: number) {
  const runMin = Math.max(0, plannedMin - downMin);
  const availability = plannedMin > 0 ? runMin / plannedMin : 0;
  const performance = runMin > 0 ? Math.min(1, actualPcs / (ratedPcsHr * runMin / 60)) : 0;
  const quality = actualPcs > 0 ? goodPcs / actualPcs : 0;
  return { availability, performance, quality, oee: availability * performance * quality };
}

/* ---------- stock from the ledger ---------- */
export type StockKey = { stage?: Stage; itemId?: string; status?: StockStatus; plant?: Plant; soId?: string; lotOrHeat?: string };
export function stockOf(ledger: LedgerRow[], key: StockKey) {
  let pcs = 0, kg = 0;
  for (const r of ledger) {
    if (key.stage && r.stage !== key.stage) continue;
    if (key.itemId && r.itemId !== key.itemId) continue;
    if (key.status && r.status !== key.status) continue;
    if (key.plant && r.plant !== key.plant) continue;
    if (key.soId !== undefined && (r.soId ?? '') !== key.soId) continue;
    if (key.lotOrHeat && r.lotOrHeat !== key.lotOrHeat) continue;
    pcs += r.pcs; kg += r.kg;
  }
  return { pcs: Math.round(pcs), kg: round3(kg) };
}
