const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2Fmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const inr = (n: number) => '₹' + inrFmt.format(Math.round(n || 0));
export const inr2 = (n: number) => '₹' + inr2Fmt.format(n || 0);
export const grams = (n: number, digits = 3) => `${(n || 0).toFixed(digits)} g`;

/** ₹14.9L, ₹1.2Cr, ₹68.5K: the short form used on dashboard cards. */
export function inrShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return inr(n);
}

export const todayISO = () => isoDate(new Date());
export function isoDate(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
export function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}
export function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export function daysBetween(a: string, b: string) {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
}
export function niceDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function shortDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
export function timeAgo(ts: number) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

let counter = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const numFmt = (d: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
/** 48,000 · 3,229.3 — Indian grouping, fixed decimals. */
export const num = (n: number, digits = 0) => numFmt(digits).format(n || 0);
export const kgs = (n: number, digits = 0) => `${num(n, digits)} kg`;
export const mt = (kg: number) => `${num(kg / 1000, 2)} MT`;
export const pcs = (n: number) => `${num(n)} pcs`;
