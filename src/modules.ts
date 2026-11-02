import { useSyncExternalStore } from 'react';
import {
  ClipboardList, CalendarRange, ShoppingCart, Truck, Factory, Flame, PackageCheck, Layers, Route, Wrench, Gauge,
  BarChart3, CheckSquare, Database, LayoutDashboard, type LucideIcon,
} from 'lucide-react';
import type { ModuleId, Role } from './data/types';

export interface ModuleDef { id: ModuleId; title: string; icon: LucideIcon; step?: string; blurb: string }

/** The order-to-invoice chain, in the order material moves through the plant. */
export const FLOW: ModuleDef[] = [
  { id: 'sales', step: '1', title: 'Sales orders', icon: ClipboardList, blurb: 'Client PO, BOQ, sourcing split and the status of every line' },
  { id: 'planning', step: '2', title: 'Planning', icon: CalendarRange, blurb: 'Net requirement and the machine-wise board by shift' },
  { id: 'purchase', step: '3', title: 'Purchase', icon: ShoppingCart, blurb: 'Indents, RFQs, quote comparison, POs and outsourcing' },
  { id: 'inward', step: '4', title: 'Inward & QC', icon: Truck, blurb: 'Gate entry, weighbridge, GRN and incoming inspection' },
  { id: 'production', step: '5', title: 'Production', icon: Factory, blurb: 'Job cards, material issue, lots, in-process QC and scrap' },
  { id: 'galvanising', step: '6', title: 'Galvanising', icon: Flame, blurb: 'GI batches, coating checks and zinc pick-up' },
  { id: 'dispatch', step: '7–9', title: 'Pack, dispatch & bill', icon: PackageCheck, blurb: 'Packs, TPI, MDCC, dispatch and invoices' },
];
export const PLANT: ModuleDef[] = [
  { id: 'stock', title: 'Stage-wise stock', icon: Layers, blurb: 'Stock at every stage from the one ledger' },
  { id: 'trace', title: 'Traceability', icon: Route, blurb: 'Pack to heat number, or heat to customer' },
  { id: 'maintenance', title: 'Maintenance', icon: Wrench, blurb: 'Breakdowns, PM schedule and machine history' },
  { id: 'controls', title: 'Plant controls', icon: Gauge, blurb: 'Downtime, roster, OEE and output by person' },
];
export const MANAGE: ModuleDef[] = [
  { id: 'dashboard', title: 'Management dashboard', icon: LayoutDashboard, blurb: 'The whole plant on one screen' },
  { id: 'reports', title: 'Reports', icon: BarChart3, blurb: 'All 43 reports' },
  { id: 'approvals', title: 'Approvals', icon: CheckSquare, blurb: 'Waiting for your decision' },
  { id: 'masters', title: 'Masters', icon: Database, blurb: 'Items, BOMs, machines, parties and people' },
];
export const ALL = [...MANAGE.slice(0, 1), ...FLOW, ...PLANT, ...MANAGE.slice(1)];
export const moduleDef = (id: ModuleId) => ALL.find(m => m.id === id)!;

export const ROLES: Role[] = ['Management', 'Admin', 'Sales', 'Purchase', 'Stores', 'QC', 'Planner', 'Prod. in-charge', 'Operator', 'GI in-charge', 'Dispatch', 'Maintenance', 'Accounts'];

/** Default screen access per role (editable by admin in the full system). */
export const ACCESS: Record<Role, ModuleId[]> = {
  Admin: ALL.map(m => m.id),
  Management: ALL.map(m => m.id),
  Sales: ['dashboard', 'sales', 'dispatch', 'stock', 'trace', 'reports', 'approvals', 'masters'],
  Purchase: ['purchase', 'inward', 'stock', 'sales', 'reports', 'approvals', 'masters'],
  Stores: ['inward', 'stock', 'production', 'purchase', 'trace', 'approvals'],
  QC: ['inward', 'production', 'galvanising', 'dispatch', 'trace', 'stock', 'approvals'],
  Planner: ['planning', 'sales', 'production', 'purchase', 'stock', 'maintenance', 'reports'],
  'Prod. in-charge': ['production', 'planning', 'galvanising', 'controls', 'maintenance', 'stock', 'trace', 'approvals', 'reports'],
  Operator: ['production', 'maintenance', 'controls'],
  'GI in-charge': ['galvanising', 'production', 'stock', 'controls'],
  Dispatch: ['dispatch', 'sales', 'stock', 'trace', 'reports'],
  Maintenance: ['maintenance', 'controls', 'planning'],
  Accounts: ['dispatch', 'sales', 'purchase', 'stock', 'reports'],
};
export const homeFor = (role: Role): ModuleId => ACCESS[role][0];

/* ---------- tiny hash router ---------- */
const VALID = new Set<string>(ALL.map(m => m.id));
function current(): ModuleId {
  const id = window.location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return (VALID.has(id) ? id : 'dashboard') as ModuleId;
}
export function useRoute(): ModuleId {
  return useSyncExternalStore(fn => { window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); }, current);
}
export function go(id: ModuleId, focus?: string) {
  if (focus) setFocus(focus);
  if (current() !== id) window.location.hash = `/${id}`;
  else window.dispatchEvent(new Event('macanx-focus'));
}

/* A record to open after navigating, e.g. a pack number for the trace screen. */
let focus: string | null = null;
export function setFocus(f: string) { focus = f; }
export function takeFocus() { const f = focus; focus = null; return f; }
