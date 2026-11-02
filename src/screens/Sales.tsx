import { useMemo, useState } from 'react';
import { Plus, ArrowLeft, FileText, ClipboardPaste, Trash2, AlertTriangle, Pencil, XCircle, CheckCircle2 } from 'lucide-react';
import { useDB, act } from '../data/store';
import { PageHead, Code, StepBars } from '../components/shell';
import { Button, Badge, DataTable, Modal, FormModal, SearchBox, Panel, KV, notify, matches, type Tone } from '../components/ui';
import { num, inrShort, inr2, niceDate, addDays, kgs } from '../lib/format';
import { kgFromPcs, pcsFromMt, stockOf } from '../lib/plant';
import { createSalesOrder, amendLine, requestShortClose, decide, item, party, bomFor, type NewSo } from '../lib/actions';
import { lineProgress, soValue, inPlant } from '../lib/metrics';
import { today } from '../lib/inventory';
import type { SalesOrder, SoStatus, DB } from '../data/types';

const STATUS_TONE: Record<SoStatus, Tone> = { Draft: 'grey', Approved: 'blue', 'In production': 'blue', 'Part dispatched': 'gold', Closed: 'green', 'Short-closed': 'red' };

export function Sales() {
  const db = useDB();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const orders = inPlant(db).orders.filter(o => matches(q, o.no, o.clientPo, o.project, party(db, o.customerId).name));
  const current = db.orders.find(o => o.id === open);

  if (current) return <SoDetail so={current} onBack={() => setOpen(null)} />;
  return (
    <>
      <PageHead title="Sales orders" sub="Every work order, purchase, GI batch, MDCC and invoice links back to a line on one of these orders."
        actions={<Button variant="signal" icon={<Plus size={16} />} onClick={() => setCreating(true)}>New sales order</Button>} />
      <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder="Search SO, client PO, customer" /></div>
      <DataTable rows={orders} onRowClick={o => setOpen(o.id)} columns={[
        { key: 'no', label: 'SO', value: o => o.no, render: o => <div className="cell2"><Code>{o.no}</Code><small>rev {o.version}</small></div> },
        { key: 'cust', label: 'Customer & project', render: o => <div className="cell2"><span>{party(db, o.customerId).name}</span><small>{o.project}</small></div> },
        { key: 'po', label: 'Client PO', render: o => <div className="cell2"><Code>{o.clientPo}</Code><small>{niceDate(o.poDate)}</small></div> },
        { key: 'value', label: 'Value', align: 'right', value: o => soValue(o), render: o => inrShort(soValue(o)) },
        { key: 'prog', label: 'Dispatched', align: 'right', render: o => {
          const ord = o.lines.reduce((s, l) => s + l.qtyPcs, 0);
          const dis = o.lines.reduce((s, l) => s + lineProgress(db, o.id, l.id).counts.dispatched, 0);
          return `${Math.round(dis / ord * 100)}%`;
        } },
        { key: 'flags', label: 'TPI / MDCC', render: o => <span className="muted small">{o.tpi ? 'TPI' : 'No TPI'}, {o.mdcc ? 'MDCC' : 'no MDCC'}</span> },
        { key: 'status', label: 'Status', value: o => o.status, render: o => <Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge> },
      ]} />
      {creating && <NewSoForm onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setOpen(id); }} />}
    </>
  );
}

function SoDetail({ so, onBack }: { so: SalesOrder; onBack: () => void }) {
  const db = useDB();
  const [amend, setAmend] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const pendingApproval = db.approvals.find(a => a.ref === so.id && a.kind === 'Sales order' && a.state === 'Pending');
  const canApprove = ['Sales', 'Management', 'Admin'].includes(db.role);
  return (
    <>
      <PageHead title={so.no} sub={`${party(db, so.customerId).name}, ${so.project}`}
        actions={<>
          <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={onBack}>All orders</Button>
          {pendingApproval && canApprove && <Button variant="signal" icon={<CheckCircle2 size={16} />} onClick={() => {
            const r = act(d => decide(d, pendingApproval.id, true));
            if (r) notify(r, 'warn'); else notify(`${so.no} approved and released to planning`);
          }}>Approve and release</Button>}
          {!['Closed', 'Short-closed', 'Draft'].includes(so.status) && <Button variant="ghost" icon={<XCircle size={16} />} onClick={() => setClosing(true)}>Short-close</Button>}
        </>} />
      <Panel title="Client PO">
        <KV items={[
          ['Client PO', <Code>{so.clientPo}</Code>], ['PO date', niceDate(so.poDate)], ['Status', <Badge tone={STATUS_TONE[so.status]}>{so.status}</Badge>],
          ['Revision', `rev ${so.version}`], ['Inspection', so.tpi ? 'TPI required' : 'No TPI'], ['MDCC', so.mdcc ? 'Required' : 'Not required'],
          ['Dispatch tolerance', `±${so.tolerancePct}%`], ['Packing', so.packing], ['Terms', party(db, so.customerId).terms],
        ]} />
        {pendingApproval && <p className="refusal" style={{ background: 'var(--hold-bg)', color: 'var(--hold)' }}><AlertTriangle size={15} />Waiting for the sales head. Planning cannot see this order until it is approved.</p>}
        {so.closeReason && <p className="muted small" style={{ marginTop: 10 }}>Short-closed: {so.closeReason}</p>}
      </Panel>

      <Panel title="SO status board" action={<span className="muted small">Balance at every step, for every line and every source</span>}>
        {so.lines.map(l => {
          const p = lineProgress(db, so.id, l.id);
          const bought = l.qtyPcs - l.inhousePcs;
          return (
            <section className="so-line" key={l.id}>
              <div className="so-line__meta">
                <h4>{p.item.name}</h4>
                <span className="muted small">“{l.boqText}”</span>
                <span><Code>{p.item.code}</Code></span>
                <span className="num">{num(l.qtyPcs)} pcs ({kgs(p.kg)}) at {inr2(l.rate)}/pc, due {niceDate(l.due)}</span>
                <div className="split-bar" aria-label="Sourcing split"><i style={{ width: `${l.inhousePcs / l.qtyPcs * 100}%` }} /><b style={{ width: `${bought / l.qtyPcs * 100}%` }} /></div>
                <div className="legend-row"><span>Made {num(l.inhousePcs)}</span>{bought > 0 && <span className="bought">Bought {l.boughtStage?.toLowerCase()} {num(bought)}</span>}</div>
                {l.splitReason && <span className="muted small">Why bought: {l.splitReason}</span>}
                <span className="small">Balance to dispatch: <strong>{num(Math.max(0, p.balance))} pcs</strong></span>
                {!['Closed', 'Short-closed'].includes(so.status) && <div><Button small variant="ghost" icon={<Pencil size={14} />} onClick={() => setAmend(l.id)}>Amend line</Button></div>}
              </div>
              <StepBars steps={p.steps} total={l.qtyPcs} />
            </section>
          );
        })}
      </Panel>

      <Panel title="Amendment history">
        {so.amendments.length === 0 ? <p className="muted">No amendments. Every change is saved as a new revision with its reason; nothing is overwritten.</p> : (
          <table className="table table--compact"><thead><tr><th>Rev</th><th>Date</th><th>Reason</th><th>By</th></tr></thead>
            <tbody>{so.amendments.map(a => <tr key={a.version}><td>rev {a.version}</td><td>{niceDate(a.date)}</td><td>{a.reason}</td><td>{a.by}</td></tr>)}</tbody></table>
        )}
      </Panel>

      {amend && (() => {
        const l = so.lines.find(x => x.id === amend)!;
        return (
          <FormModal title="Amend SO line" subtitle={item(db, l.itemId).name} onClose={() => setAmend(null)} submitLabel="Save as new revision"
            initial={{ qtyPcs: l.qtyPcs, rate: l.rate, due: l.due, inhousePcs: l.inhousePcs, reason: '' }}
            fields={[
              { key: 'qtyPcs', label: 'Quantity (pcs)', type: 'number', required: true },
              { key: 'rate', label: 'Rate (₹ per piece)', type: 'number', required: true, step: '0.01' },
              { key: 'due', label: 'Delivery date', type: 'date', required: true },
              { key: 'inhousePcs', label: 'Made in-house (pcs)', type: 'number', required: true, hint: 'The rest is bought. Can change until a PO or work order is released for it.' },
              { key: 'reason', label: 'Reason for the change', type: 'textarea', required: true },
            ]}
            onSubmit={v => {
              if (Number(v.inhousePcs) > Number(v.qtyPcs)) return 'In-house pieces cannot be more than the line quantity.';
              const r = act(d => amendLine(d, so.id, l.id, { qtyPcs: Number(v.qtyPcs), rate: Number(v.rate), due: v.due, inhousePcs: Number(v.inhousePcs) }, v.reason));
              if (r) return r;
              notify(`Saved as rev ${so.version + 1}; sent to the sales head`);
            }} />
        );
      })()}
      {closing && (
        <FormModal title={`Short-close ${so.no}`} subtitle="Open plans and reservations are cancelled automatically once management approves." onClose={() => setClosing(false)} submitLabel="Send for approval"
          initial={{ reason: '' }} fields={[{ key: 'reason', label: 'Reason', type: 'textarea', required: true }]}
          onSubmit={v => { const r = act(d => requestShortClose(d, so.id, v.reason)); if (r) return r; notify('Short-close sent to management'); }} />
      )}
    </>
  );
}

/* ---------- new SO with BOQ ---------- */
type DraftLine = { boqText: string; itemId: string; qty: number; unit: 'pcs' | 'MT'; rate: number; due: string; inhousePct: number; boughtStage: 'Finished' | 'Semi-finished'; splitReason: string };
const SAMPLE_BOQ = `Hex bolt M20 x 70 gr 8.8 HDG with nut, 12000, pcs, 26.40
HDG hex nut M20 class 8, 12000, pcs, 6.10
Step bolt M16 x 175 HDG, 1.2, MT, 31.00`;

/** Suggests an item code for the customer's words: size, length and product. */
function matchItem(db: DB, text: string) {
  const t = text.toLowerCase().replace(/×/g, 'x');
  const m = t.match(/m\s?(\d{2})(?:\s?x\s?(\d{2,3}))?/);
  const dia = m ? Number(m[1]) : undefined; const len = m?.[2] ? Number(m[2]) : undefined;
  const wantsNut = /\bnut\b/.test(t) && !/with nut|with \d nut/.test(t);
  const wantsStep = /step/.test(t); const wantsWasher = /washer/.test(t);
  return db.items.find(i => i.dia === dia && (wantsNut ? i.product === 'Hex nut' : wantsWasher ? i.product === 'Washer' : wantsStep ? i.product === 'Step bolt' : i.product === 'Hex bolt') && (len === undefined || i.length === undefined || i.length === len))?.id ?? '';
}

function NewSoForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const db = useDB();
  const customers = db.parties.filter(p => p.type === 'Customer');
  const [head, setHead] = useState({ customerId: '', clientPo: '', poDate: today(), project: '', tpi: true, mdcc: true, tolerancePct: 2, packing: '25 kg HDPE bags' });
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [paste, setPaste] = useState(false);
  const [error, setError] = useState('');
  const fg = db.items.filter(i => i.type === 'Finished' || i.type === 'Bought-out');
  const setLine = (i: number, p: Partial<DraftLine>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...p } : l));

  const pcsOf = (l: DraftLine) => l.itemId && l.unit === 'MT' ? pcsFromMt(item(db, l.itemId), l.qty) : Math.round(l.qty);
  const feas = useMemo(() => lines.map(l => {
    if (!l.itemId) return null;
    const it = item(db, l.itemId); const pcs = pcsOf(l);
    const inhouse = Math.round(pcs * l.inhousePct / 100);
    const b = bomFor(db, it.id);
    if (!b || inhouse === 0) return { text: 'Bought: promise after vendor lead time', promise: addDays(today(), it.leadDays + 4) };
    const need = inhouse * b.inputKgPer1000 / 1000;
    const free = stockOf(db.ledger, { itemId: b.rmItemId, stage: 'RM', status: 'Free', plant: db.plant }).kg;
    const onOrder = db.pos.filter(p => p.status === 'Open' && p.lines[0].itemId === b.rmItemId).reduce((s, p) => s + p.lines[0].qtyKg - p.lines[0].receivedKg, 0);
    const short = need > free;
    return { text: `${item(db, b.rmItemId).name}: needs ${kgs(need)}, ${kgs(free)} free, ${kgs(onOrder)} on order`, promise: addDays(today(), short ? item(db, b.rmItemId).leadDays + it.leadDays : it.leadDays), short };
  }), [lines, db]);

  const save = () => {
    if (!head.customerId || !head.clientPo.trim() || !head.project.trim()) { setError('Enter the customer, client PO number and project.'); return; }
    const data: NewSo = {
      ...head, tolerancePct: Number(head.tolerancePct),
      lines: lines.map(l => {
        const pcs = pcsOf(l);
        const inhouse = Math.round(pcs * l.inhousePct / 100);
        return { boqText: l.boqText, itemId: l.itemId, qtyPcs: pcs, rate: l.rate, due: l.due, inhousePcs: inhouse, boughtStage: inhouse < pcs ? l.boughtStage : undefined, splitReason: inhouse < pcs ? l.splitReason : undefined };
      }),
    };
    const r = act(d => createSalesOrder(d, data));
    if (typeof r === 'string') { setError(r); return; }
    notify(`${r.no} saved as draft; sent to the sales head for approval`);
    onCreated(r.id);
  };

  return (
    <Modal title="New sales order" subtitle="Enter the client PO as the customer sent it, then their BOQ line by line." wide onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save draft and send for approval</Button></>}>
      <div className="stack">
        <div className="form-grid form-grid--3">
          <div className="field"><label htmlFor="so-c">Customer<em>*</em></label>
            <select id="so-c" value={head.customerId} onChange={e => setHead({ ...head, customerId: e.target.value })}><option value="">Choose…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="field"><label htmlFor="so-po">Client PO no.<em>*</em></label><input id="so-po" value={head.clientPo} onChange={e => setHead({ ...head, clientPo: e.target.value })} /></div>
          <div className="field"><label htmlFor="so-pd">PO date</label><input id="so-pd" type="date" value={head.poDate} onChange={e => setHead({ ...head, poDate: e.target.value })} /></div>
          <div className="field field--full"><label htmlFor="so-pr">Project / site<em>*</em></label><input id="so-pr" value={head.project} onChange={e => setHead({ ...head, project: e.target.value })} /></div>
          <label className="field field--check"><input type="checkbox" checked={head.tpi} onChange={e => setHead({ ...head, tpi: e.target.checked })} />Third-party inspection</label>
          <label className="field field--check"><input type="checkbox" checked={head.mdcc} onChange={e => setHead({ ...head, mdcc: e.target.checked })} />MDCC before dispatch</label>
          <div className="field"><label htmlFor="so-tol">Dispatch tolerance ±%</label><input id="so-tol" type="number" value={head.tolerancePct} onChange={e => setHead({ ...head, tolerancePct: Number(e.target.value) })} /></div>
          <div className="field field--full"><label htmlFor="so-pk">Packing instructions</label><input id="so-pk" value={head.packing} onChange={e => setHead({ ...head, packing: e.target.value })} /></div>
        </div>

        <div className="toolbar">
          <h3 style={{ fontSize: 18 }}>BOQ lines</h3><span className="grow" />
          <Button small variant="ghost" icon={<ClipboardPaste size={14} />} onClick={() => setPaste(true)}>Paste BOQ from Excel</Button>
          <Button small variant="ghost" icon={<Plus size={14} />} onClick={() => setLines(ls => [...ls, { boqText: '', itemId: '', qty: 0, unit: 'pcs', rate: 0, due: addDays(today(), 21), inhousePct: 100, boughtStage: 'Finished', splitReason: '' }])}>Add line</Button>
        </div>
        {lines.length === 0 && <div className="empty"><FileText size={22} /><p>Add lines, or paste the customer's BOQ: we match each line to an item code.</p></div>}
        {lines.map((l, i) => (
          <div className="panel" key={i} style={{ padding: 12 }}>
            <div className="form-grid form-grid--3">
              <div className="field field--full"><label>Customer's description</label><input value={l.boqText} onChange={e => setLine(i, { boqText: e.target.value, itemId: l.itemId || matchItem(db, e.target.value) })} /></div>
              <div className="field"><label>Our item code<em>*</em></label>
                <select value={l.itemId} onChange={e => setLine(i, { itemId: e.target.value })} style={!l.itemId ? { borderColor: 'var(--bad)' } : undefined}>
                  <option value="">Not matched</option>{fg.map(f => <option key={f.id} value={f.id}>{f.code} · {f.name}</option>)}
                </select></div>
              <div className="field"><label>Quantity</label><div className="picker"><input type="number" value={l.qty || ''} onChange={e => setLine(i, { qty: Number(e.target.value) })} />
                <select value={l.unit} onChange={e => setLine(i, { unit: e.target.value as 'pcs' | 'MT' })} style={{ maxWidth: 80 }}><option>pcs</option><option>MT</option></select></div>
                {l.itemId && <small>{num(pcsOf(l))} pcs, {kgs(kgFromPcs(item(db, l.itemId), pcsOf(l)))}</small>}</div>
              <div className="field"><label>Rate (₹/pc)</label><input type="number" step="0.01" value={l.rate || ''} onChange={e => setLine(i, { rate: Number(e.target.value) })} /></div>
              <div className="field"><label>Delivery date</label><input type="date" value={l.due} onChange={e => setLine(i, { due: e.target.value })} /></div>
              <div className="field"><label>Made in-house: {l.inhousePct}%</label><input type="range" min={0} max={100} step={10} value={l.inhousePct} onChange={e => setLine(i, { inhousePct: Number(e.target.value) })} /></div>
              {l.inhousePct < 100 && <>
                <div className="field"><label>Bought as</label><select value={l.boughtStage} onChange={e => setLine(i, { boughtStage: e.target.value as DraftLine['boughtStage'] })}><option>Finished</option><option>Semi-finished</option></select></div>
                <div className="field"><label>Why bought</label><select value={l.splitReason} onChange={e => setLine(i, { splitReason: e.target.value })}><option value="">Choose…</option>{['Capacity', 'Size outside machine range', 'Delivery date', 'Cost', 'Not made in-house'].map(r => <option key={r}>{r}</option>)}</select></div>
              </>}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {feas[i] && <span className={`small ${feas[i]!.short ? 'tone-red' : 'muted'}`}>Feasibility: {feas[i]!.text}. Suggested promise date {niceDate(feas[i]!.promise)}.</span>}
              <span className="grow" />
              <button className="icon-btn" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove line"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
        {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
      </div>
      {paste && (
        <FormModal title="Paste BOQ" subtitle="One line per item: description, quantity, unit (pcs or MT), rate. Copy straight from the customer's Excel." onClose={() => setPaste(false)} submitLabel="Add lines"
          initial={{ text: SAMPLE_BOQ }} fields={[{ key: 'text', label: 'BOQ rows', type: 'textarea', full: true }]}
          onSubmit={v => {
            const rows = String(v.text).split('\n').map(r => r.split(/\t|,/).map(c => c.trim())).filter(r => r[0]);
            if (!rows.length) return 'Paste at least one row.';
            setLines(ls => [...ls, ...rows.map(r => ({
              boqText: r[0], itemId: matchItem(db, r[0]), qty: Number(r[1]) || 0, unit: (r[2]?.toUpperCase() === 'MT' ? 'MT' : 'pcs') as 'pcs' | 'MT',
              rate: Number(r[3]) || 0, due: addDays(today(), 21), inhousePct: /nut|washer/i.test(r[0]) ? 0 : 100, boughtStage: 'Finished' as const,
              splitReason: /nut|washer/i.test(r[0]) ? 'Not made in-house' : '',
            }))]);
            notify(`${rows.length} lines added. Check the item codes we matched.`, 'info');
          }} />
      )}
    </Modal>
  );
}
