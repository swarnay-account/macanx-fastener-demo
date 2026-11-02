export type ModuleId =
  | 'dashboard' | 'sales' | 'planning' | 'purchase' | 'inward' | 'production' | 'galvanising' | 'dispatch'
  | 'stock' | 'trace' | 'maintenance' | 'controls' | 'reports' | 'masters' | 'approvals';

export type Plant = 'AHD' | 'MUN';

/** The seven places stock can sit, raw material to packed. */
export type Stage = 'RM' | 'DRAWN' | 'FORGED' | 'THREADED' | 'HT' | 'GALV' | 'PACKED';
export type StockStatus = 'Quality hold' | 'Free' | 'Reserved' | 'Rejected' | 'In transit' | 'With job worker';

export type ItemType = 'Raw material' | 'Consumable' | 'Semi-finished' | 'Finished' | 'Bought-out' | 'Scrap';
export type Finish = 'Black' | 'HDG' | 'Cold GI' | 'Electroplated' | 'Plain';
export type Source = 'Make' | 'Buy' | 'Both';

export interface Item {
  id: string; code: string; name: string; type: ItemType;
  product?: string; dia?: number; length?: number; propertyClass?: string; standard?: string; finish?: Finish;
  grade?: string; kgPer1000: number; hsn: string; reorderKg?: number; leadDays: number; source: Source;
}
export interface Grade { id: string; name: string; c: string; mn: string; b?: string; tensile: string }
export interface Bom { itemId: string; rmItemId: string; inputKgPer1000: number; yieldPct: number; scrapPct: number }

export type MachineType = 'Wire drawing' | 'Header' | 'Thread roller' | 'HT furnace' | 'GI kettle' | 'Packing';
export interface Machine {
  id: string; code: string; name: string; type: MachineType; plant: Plant; section: string;
  diaMin: number; diaMax: number; ratedPcsHr: number; ratedKgHr: number; loadLimitKg?: number;
  status: 'Running' | 'Idle' | 'Breakdown' | 'PM';
}

export type PartyType = 'Customer' | 'Supplier' | 'Job worker' | 'TPI agency';
export interface Party { id: string; name: string; type: PartyType; city: string; gstin: string; terms: string; rating?: number }

export type Role =
  | 'Admin' | 'Management' | 'Sales' | 'Purchase' | 'Stores' | 'QC' | 'Planner' | 'Prod. in-charge'
  | 'Operator' | 'GI in-charge' | 'Dispatch' | 'Maintenance' | 'Accounts';
export interface Employee { id: string; name: string; role: Role; plant: Plant; skills: string[] }

/* ---------- Sales ---------- */
export type SoStatus = 'Draft' | 'Approved' | 'In production' | 'Part dispatched' | 'Closed' | 'Short-closed';
export interface SoLine {
  id: string; boqText: string; itemId: string; qtyPcs: number; rate: number; due: string;
  /** Pieces made in-house; the rest is bought. */
  inhousePcs: number; boughtStage?: 'Finished' | 'Semi-finished'; splitReason?: string;
}
export interface SoAmendment { version: number; date: string; reason: string; by: string }
export interface SalesOrder {
  id: string; no: string; plant: Plant; customerId: string; clientPo: string; poDate: string; project: string;
  tpi: boolean; mdcc: boolean; tolerancePct: number; packing: string; status: SoStatus; version: number;
  amendments: SoAmendment[]; lines: SoLine[]; closeReason?: string;
}

/* ---------- Purchase ---------- */
export type ApprovalState = 'Pending' | 'Approved' | 'Rejected';
export interface Indent {
  id: string; no: string; date: string; itemId: string; qtyKg: number; qtyPcs?: number; needBy: string;
  department: string; soId?: string; purpose: string; status: ApprovalState | 'On PO';
}
export interface Quote { vendorId: string; ratePerKg: number; freightPerKg: number; gstPct: number; days: number; terms: string }
export interface Rfq { id: string; no: string; indentId: string; date: string; quotes: Quote[]; chosenVendorId?: string; reason?: string }
export interface PoLine { itemId: string; qtyKg: number; rate: number; receivedKg: number }
export interface PurchaseOrder {
  id: string; no: string; date: string; vendorId: string; indentIds: string[]; soId?: string; kind: 'Material' | 'Outsourced' | 'Job work';
  lines: PoLine[]; tolerancePct: number; due: string; status: ApprovalState | 'Open' | 'Closed'; value: number;
}

/* ---------- Inward ---------- */
export interface GrnLine { itemId: string; heatNo: string; coils: number; kg: number; pcs?: number }
export interface Grn {
  id: string; no: string; date: string; poId: string; vendorId: string; vehicle: string; invoiceNo: string; ewayBill: string;
  invoiceKg: number; grossKg: number; tareKg: number; lines: GrnLine[];
  qc: 'Quality hold' | 'Accepted' | 'Accepted with deviation' | 'Rejected';
  qcNote?: string; tc: { c: number; mn: number; b?: number; tensile: number }; soId?: string;
}

/* ---------- Planning & production ---------- */
export type Shift = 'Day' | 'Night';
export type Operation = 'Drawing' | 'Heading' | 'Threading' | 'Heat treatment';
export interface WorkOrder {
  id: string; no: string; soId: string; lineId: string; itemId: string; operation: Operation; machineId: string;
  date: string; shift: Shift; targetPcs: number; status: 'Planned' | 'Released' | 'Running' | 'Closed';
  operatorId: string; issued: { heatNo: string; kg: number }[]; outputPcs: number; outputKg: number;
  scrapKg: number; rejectKg: number; lots: string[]; dieSet: string;
}
export interface Lot {
  no: string; itemId: string; stage: Stage; pcs: number; kg: number; heats: string[]; woId?: string; machineId?: string;
  operatorId?: string; date: string; shift?: Shift; status: StockStatus; soId?: string; ipqc: 'Pending' | 'Pass' | 'Fail';
  source: 'In-house' | 'Bought'; vendorBatch?: string; parents?: string[]; batchId?: string;
}

/* ---------- Galvanising ---------- */
export interface GiBatch {
  id: string; no: string; date: string; shift: Shift; kettleId: string; type: 'HDG' | 'Cold GI'; lots: string[];
  blackKg: number; giKg: number; tempC: number; dipSec: number; spinSec: number;
  coatingMin: number; coatingAvg: number; pre: 'Pass' | 'Fail'; post: 'Pending' | 'Pass' | 'Fail';
  status: 'In kettle' | 'Passed' | 'Re-dip' | 'Handed to packing'; zincKg: number; redips?: number;
}

/* ---------- Packing & dispatch ---------- */
export interface Pack {
  no: string; soId: string; lineId: string; itemId: string; giBatchId?: string; lots: string[];
  pcs: number; netKg: number; grossKg: number; packing: string;
  state: 'Packed' | 'TPI offered' | 'TPI accepted' | 'TPI rejected' | 'Dispatched'; mdccId?: string; dispatchId?: string;
}
export interface Tpi { id: string; no: string; soId: string; lineId: string; agencyId: string; date: string; packs: string[]; offeredPcs: number; acceptedPcs: number; rejectedPcs: number; report: string; status: 'Offered' | 'Done' }
export interface Mdcc { id: string; no: string; soId: string; lineId: string; date: string; validTill: string; pcs: number; usedPcs: number }
export interface Dispatch { id: string; no: string; soId: string; lineId: string; date: string; packs: string[]; pcs: number; kg: number; vehicle: string; transporter: string; lr: string; ewayBill: string; mdccId?: string }
export interface Invoice { id: string; no: string; soId: string; lineId: string; dispatchId: string; date: string; pcs: number; taxable: number; gst: number; total: number }

/* ---------- Ledger ---------- */
export type MoveType = 'Receipt' | 'QC release' | 'Issue' | 'Production' | 'Handover' | 'Galvanising' | 'Packing' | 'Dispatch' | 'Scrap' | 'Adjustment' | 'Rejection';
/** One stock movement. Stock anywhere is the sum of these rows: nothing else writes stock. */
export interface LedgerRow {
  id: string; date: string; ts: number; type: MoveType; plant: Plant; itemId: string; ref: string;
  stage: Stage; status: StockStatus; lotOrHeat: string; pcs: number; kg: number; soId?: string; user: string;
}

/* ---------- Plant controls & maintenance ---------- */
export type DowntimeReason = 'Breakdown' | 'Die change' | 'No material' | 'No power' | 'No operator' | 'QC hold' | 'PM' | 'No plan';
export interface Downtime { id: string; machineId: string; date: string; shift: Shift; minutes: number; reason: DowntimeReason; note: string }
export interface Breakdown {
  id: string; no: string; machineId: string; raisedBy: string; problem: string; stoppedAt: string;
  restoredAt?: string; work?: string; spares: { name: string; qty: number; cost: number }[]; status: 'Open' | 'Restored';
}
export interface PmTask { id: string; machineId: string; task: string; everyDays: number; lastDone: string; hours: number }
export interface Roster { date: string; shift: Shift; machineId: string; operatorId: string; inchargeId: string; supervisorId: string }

export type ApprovalKind = 'Sales order' | 'Indent' | 'Purchase Order' | 'Non-lowest vendor' | 'SO amendment' | 'Sourcing split'
  | 'Quality deviation' | 'Partial RM release' | 'Stock adjustment' | 'Short-close' | 'Machine overload' | 'Shift correction';
export interface Approval {
  id: string; date: string; kind: ApprovalKind;
  ref: string; text: string; value?: number; approverRole: Role; state: ApprovalState; decidedBy?: string; payload?: any;
}

export interface Activity { id: string; ts: number; module: ModuleId; text: string }

export interface DB {
  version: number; seededOn: string;
  plant: Plant; role: Role;
  items: Item[]; grades: Grade[]; boms: Bom[]; machines: Machine[]; parties: Party[]; employees: Employee[];
  orders: SalesOrder[]; indents: Indent[]; rfqs: Rfq[]; pos: PurchaseOrder[]; grns: Grn[];
  workOrders: WorkOrder[]; lots: Lot[]; batches: GiBatch[]; packs: Pack[]; tpis: Tpi[]; mdccs: Mdcc[];
  dispatches: Dispatch[]; invoices: Invoice[]; ledger: LedgerRow[];
  downtime: Downtime[]; breakdowns: Breakdown[]; pm: PmTask[]; roster: Roster[];
  approvals: Approval[]; activity: Activity[]; counters: Record<string, number>;
}
