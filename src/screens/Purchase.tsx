import { useState } from 'react';
import { Plus, Scale, Send } from 'lucide-react';
import { useDB, act } from '../data/store';
import { PageHead, Code } from '../components/shell';
import { Button, Badge, DataTable, Modal, FormModal, Tabs, notify, type Tone } from '../components/ui';
import { num, kgs, inr, inr2, niceDate, addDays } from '../lib/format';
import { stockOf, landedPerKg } from '../lib/plant';
import { raiseIndent, createRfq, choosePoVendor, lowestQuote, createOutsourcePo, lastPrice, item, party, bomNeedKg } from '../lib/actions';
import { lineProgress } from '../lib/metrics';
import { today } from '../lib/inventory';
import type { Rfq, Quote } from '../data/types';

const PO_TONE: Record<string, Tone> = { Pending: 'gold', Approved: 'blue', Open: 'blue', Closed: 'green', Rejected: 'red' };

export function Purchase() {
  const db = useDB();
  const [tab, setTab] = useState<'indents' | 'rfq' | 'po' | 'out' | 'follow'>('indents');
  return (
    <>
      <PageHead title="Purchase" sub="Every indent says whether it is for a sales order. That decides whether the material is reserved for the order on arrival or goes into free stock." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'indents', label: 'Indents', count: db.indents.length },
        { id: 'rfq', label: 'RFQ & comparison', count: db.rfqs.length },
        { id: 'po', label: 'Purchase orders', count: db.pos.length },
        { id: 'out', label: 'Outsourcing' },
        { id: 'follow', label: 'Due & overdue' },
      ]} />
      {tab === 'indents' && <Indents />}
      {tab === 'rfq' && <Rfqs />}
      {tab === 'po' && <Pos />}
      {tab === 'out' && <Outsourcing />}
      {tab === 'follow' && <FollowUp />}
    </>
  );
}

function Indents() {
  const db = useDB();
  const [adding, setAdding] = useState(false);
  const [rfqFor, setRfqFor] = useState<string | null>(null);
  const buyable = db.items.filter(i => i.type === 'Raw material' || i.type === 'Consumable');
  const openSos = db.orders.filter(o => !['Closed', 'Short-closed', 'Draft'].includes(o.status));
  return (
    <>
      <div className="toolbar"><span className="grow" /><Button variant="signal" icon={<Plus size={16} />} onClick={() => setAdding(true)}>Raise indent</Button></div>
      <DataTable rows={db.indents} columns={[
        { key: 'no', label: 'Indent', render: i => <div className="cell2"><Code>{i.no}</Code><small>{niceDate(i.date)}</small></div> },
        { key: 'item', label: 'Item', render: i => item(db, i.itemId).name },
        { key: 'qty', label: 'Qty', align: 'right', render: i => kgs(i.qtyKg) },
        { key: 'for', label: 'For', render: i => i.soId ? <span>SO <Code>{db.orders.find(o => o.id === i.soId)!.no}</Code></span> : <span className="muted">Stock ({i.department})</span> },
        { key: 'need', label: 'Need by', render: i => niceDate(i.needBy) },
        { key: 'st', label: 'Status', render: i => <Badge tone={i.status === 'Approved' ? 'blue' : i.status === 'On PO' ? 'green' : i.status === 'Rejected' ? 'red' : 'gold'}>{i.status}</Badge> },
      ]} actions={i => i.status === 'Approved' && !db.rfqs.some(r => r.indentId === i.id) ? <Button small variant="soft" icon={<Send size={14} />} onClick={() => setRfqFor(i.id)}>Send RFQ</Button> : null} />
      {adding && <IndentForm items={buyable} sos={openSos} onClose={() => setAdding(false)} />}
      {rfqFor && <RfqForm indentId={rfqFor} onClose={() => setRfqFor(null)} />}
    </>
  );
}

function IndentForm({ items, sos, onClose }: { items: ReturnType<typeof useDB>['items']; sos: ReturnType<typeof useDB>['orders']; onClose: () => void }) {
  const db = useDB();
  return (
    <FormModal title="Raise indent" subtitle="Approval goes to the head of department, and to the plant head above ₹5 lakh." onClose={onClose} submitLabel="Raise indent"
      initial={{ itemId: items[0].id, qtyKg: '', needBy: addDays(today(), 7), department: 'Production', soId: '', purpose: '' }}
      fields={[
        { key: 'itemId', label: 'Item', type: 'select', required: true, options: items.map(i => ({ value: i.id, label: i.name })), full: true },
        { key: 'qtyKg', label: 'Quantity (kg)', type: 'number', required: true },
        { key: 'needBy', label: 'Required by', type: 'date', required: true },
        { key: 'soId', label: 'For a sales order?', type: 'select', options: [{ value: '', label: 'No, for stock' }, ...sos.map(o => ({ value: o.id, label: `${o.no} · ${party(db, o.customerId).name}` }))] },
        { key: 'department', label: 'Department', type: 'select', options: ['Production', 'Galvanising', 'Stores', 'Maintenance', 'Packing'].map(v => ({ value: v, label: v })) },
        { key: 'purpose', label: 'Purpose', full: true, required: true },
      ]}
      aside={v => {
        const stock = stockOf(db.ledger, { itemId: v.itemId, stage: 'RM' });
        const onPo = db.pos.filter(p => p.status === 'Open' && p.lines[0].itemId === v.itemId).reduce((s, p) => s + p.lines[0].qtyKg - p.lines[0].receivedKg, 0);
        const need = v.soId ? bomNeedKg(db, v.soId, v.itemId) : 0;
        return <div className="calc-strip">
          <span>In stock<strong>{kgs(stock.kg)}</strong></span><span>Open POs<strong>{kgs(onPo)}</strong></span>
          <span>Last price<strong>{lastPrice(db, v.itemId) ? `${inr2(lastPrice(db, v.itemId))}/kg` : '—'}</strong></span>
          {v.soId && <span>BOM need for this SO<strong>{need ? kgs(need) : 'not in BOM'}</strong></span>}
        </div>;
      }}
      onSubmit={v => {
        const r = act(d => raiseIndent(d, { itemId: v.itemId, qtyKg: Number(v.qtyKg), needBy: v.needBy, department: v.department, soId: v.soId || undefined, purpose: v.purpose }));
        if (r) return r;
        notify('Indent raised and sent for approval');
      }} />
  );
}

function RfqForm({ indentId, onClose }: { indentId: string; onClose: () => void }) {
  const db = useDB();
  const ind = db.indents.find(i => i.id === indentId)!;
  const vendors = db.parties.filter(p => p.type === 'Supplier');
  const [quotes, setQuotes] = useState<Quote[]>(vendors.slice(0, 2).map((v, i) => ({ vendorId: v.id, ratePerKg: Math.round((lastPrice(db, ind.itemId) || 70) * (1 + i * 0.01) * 10) / 10, freightPerKg: 1.5 + i, gstPct: 18, days: 5 + i, terms: '30 days' })));
  const [error, setError] = useState('');
  const set = (i: number, p: Partial<Quote>) => setQuotes(qs => qs.map((q, j) => j === i ? { ...q, ...p } : q));
  return (
    <Modal title={`RFQ for ${ind.no}`} subtitle={`${item(db, ind.itemId).name}, ${kgs(ind.qtyKg)}. Enter each vendor's quote as it comes in.`} wide onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => {
        const r = act(d => createRfq(d, ind.id, quotes));
        if (r) setError(r); else { notify('Quotes saved. Compare them in RFQ & comparison.'); onClose(); }
      }}>Save quotes</Button></>}>
      <table className="table">
        <thead><tr><th>Vendor</th><th>Rate ₹/kg</th><th>Freight ₹/kg</th><th>GST %</th><th>Days</th><th>Terms</th><th /></tr></thead>
        <tbody>{quotes.map((q, i) => (
          <tr key={i}>
            <td><select className="input" value={q.vendorId} onChange={e => set(i, { vendorId: e.target.value })}>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></td>
            <td><input className="input" type="number" step="0.1" value={q.ratePerKg} onChange={e => set(i, { ratePerKg: Number(e.target.value) })} /></td>
            <td><input className="input" type="number" step="0.1" value={q.freightPerKg} onChange={e => set(i, { freightPerKg: Number(e.target.value) })} /></td>
            <td><input className="input" type="number" value={q.gstPct} onChange={e => set(i, { gstPct: Number(e.target.value) })} /></td>
            <td><input className="input" type="number" value={q.days} onChange={e => set(i, { days: Number(e.target.value) })} /></td>
            <td><input className="input" value={q.terms} onChange={e => set(i, { terms: e.target.value })} /></td>
            <td>{quotes.length > 2 && <button className="icon-btn" onClick={() => setQuotes(qs => qs.filter((_, j) => j !== i))} aria-label="Remove">×</button>}</td>
          </tr>
        ))}</tbody>
      </table>
      <div style={{ marginTop: 10 }}><Button small variant="ghost" icon={<Plus size={14} />} onClick={() => setQuotes(qs => [...qs, { vendorId: vendors[qs.length % vendors.length].id, ratePerKg: 70, freightPerKg: 2, gstPct: 18, days: 7, terms: '30 days' }])}>Add vendor</Button></div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

function Rfqs() {
  const db = useDB();
  const [open, setOpen] = useState<Rfq | null>(null);
  const rows = db.rfqs;
  return (
    <>
      <DataTable rows={rows} onRowClick={setOpen} columns={[
        { key: 'no', label: 'RFQ', render: r => <Code>{r.no}</Code> },
        { key: 'ind', label: 'Indent', render: r => <Code>{db.indents.find(i => i.id === r.indentId)?.no}</Code> },
        { key: 'item', label: 'Item', render: r => item(db, db.indents.find(i => i.id === r.indentId)!.itemId).name },
        { key: 'q', label: 'Quotes', align: 'right', render: r => r.quotes.length },
        { key: 'low', label: 'Lowest landed', render: r => { const l = lowestQuote(r.quotes); return `${party(db, l.vendorId).name}, ${inr2(landedPerKg(l))}/kg`; } },
        { key: 'ch', label: 'Chosen', render: r => r.chosenVendorId ? <span>{party(db, r.chosenVendorId).name}{r.chosenVendorId !== lowestQuote(r.quotes).vendorId && <Badge tone="gold">not lowest</Badge>}</span> : <Badge tone="grey">Open</Badge> },
      ]} actions={r => <Button small variant="soft" icon={<Scale size={14} />} onClick={() => setOpen(r)}>Compare</Button>} />
      {open && <Compare rfq={db.rfqs.find(r => r.id === open.id)!} onClose={() => setOpen(null)} />}
    </>
  );
}

function Compare({ rfq, onClose }: { rfq: Rfq; onClose: () => void }) {
  const db = useDB();
  const ind = db.indents.find(i => i.id === rfq.indentId)!;
  const low = lowestQuote(rfq.quotes);
  const [pick, setPick] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const decided = !!rfq.chosenVendorId;
  const choose = (vendorId: string) => {
    const r = act(d => choosePoVendor(d, rfq.id, vendorId, reason));
    if (r) { setError(r); setPick(vendorId); return; }
    notify(vendorId === low.vendorId ? 'PO raised on the lowest landed cost and sent for approval' : 'Choice sent to management with your reason');
    onClose();
  };
  return (
    <Modal title={`Quote comparison, ${rfq.no}`} subtitle={`${item(db, ind.itemId).name}, ${kgs(ind.qtyKg)}. Last price paid: ${lastPrice(db, ind.itemId) ? `${inr2(lastPrice(db, ind.itemId))}/kg` : 'none'}.`} wide onClose={onClose}>
      <div className="table-scroll">
        <table className="table compare">
          <thead><tr><th />{rfq.quotes.map(q => <th key={q.vendorId} className={q.vendorId === low.vendorId ? 'is-low' : ''}>{party(db, q.vendorId).name}</th>)}</tr></thead>
          <tbody>
            {([
              ['Rate per kg', (q: Quote) => inr2(q.ratePerKg)], ['Freight per kg', (q: Quote) => inr2(q.freightPerKg)], ['GST', (q: Quote) => `${q.gstPct}%`],
              ['Delivery', (q: Quote) => `${q.days} days`], ['Payment terms', (q: Quote) => q.terms], ['Vendor rating', (q: Quote) => `${party(db, q.vendorId).rating ?? '—'}`],
              ['Landed cost per kg', (q: Quote) => <strong>{inr2(landedPerKg(q))}</strong>], ['Order value', (q: Quote) => inr(q.ratePerKg * ind.qtyKg)],
            ] as const).map(([label, f]) => (
              <tr key={label}><td className="muted">{label}</td>{rfq.quotes.map(q => <td key={q.vendorId} className={q.vendorId === low.vendorId ? 'is-low' : ''}>{f(q)}</td>)}</tr>
            ))}
            {!decided && <tr><td />{rfq.quotes.map(q => <td key={q.vendorId}><Button small variant={q.vendorId === low.vendorId ? 'signal' : 'ghost'} onClick={() => choose(q.vendorId)}>Raise PO</Button></td>)}</tr>}
          </tbody>
        </table>
      </div>
      {decided && <p className="muted" style={{ marginTop: 10 }}>Chosen: {party(db, rfq.chosenVendorId!).name}{rfq.reason ? `. Reason: ${rfq.reason}` : ''}</p>}
      {pick && pick !== low.vendorId && !decided && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="nl-reason">Why not the lowest landed cost?</label>
          <textarea id="nl-reason" rows={2} value={reason} onChange={e => setReason(e.target.value)} />
          <div><Button small onClick={() => choose(pick)}>Send to management</Button></div>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

function Pos() {
  const db = useDB();
  return <DataTable rows={db.pos} columns={[
    { key: 'no', label: 'PO', render: p => <div className="cell2"><Code>{p.no}</Code><small>{niceDate(p.date)}</small></div> },
    { key: 'v', label: 'Vendor', render: p => party(db, p.vendorId).name },
    { key: 'k', label: 'Type', render: p => <Badge tone={p.kind === 'Material' ? 'grey' : 'purple'}>{p.kind}</Badge> },
    { key: 'i', label: 'Item', render: p => item(db, p.lines[0].itemId).name },
    { key: 'q', label: 'Ordered / received', align: 'right', render: p => `${kgs(p.lines[0].qtyKg)} / ${kgs(p.lines[0].receivedKg)}` },
    { key: 'val', label: 'Value', align: 'right', value: p => p.value, render: p => inr(p.value) },
    { key: 'so', label: 'SO', render: p => p.soId ? <Code>{db.orders.find(o => o.id === p.soId)!.no}</Code> : <span className="muted">Stock</span> },
    { key: 'due', label: 'Due', render: p => <span className={p.status === 'Open' && p.due < today() ? 'tone-red' : ''}>{niceDate(p.due)}</span> },
    { key: 'st', label: 'Status', render: p => <Badge tone={PO_TONE[p.status]}>{p.status === 'Pending' ? 'Awaiting approval' : p.status}</Badge> },
  ]} />;
}

function Outsourcing() {
  const db = useDB();
  const [po, setPo] = useState<{ soId: string; lineId: string } | null>(null);
  const rows = db.orders.filter(o => !['Draft', 'Short-closed', 'Closed'].includes(o.status)).flatMap(o => o.lines.filter(l => l.inhousePcs < l.qtyPcs).map(l => ({ id: l.id, o, l })));
  return (
    <>
      <p className="muted">The bought part of each SO line becomes a PO for finished or semi-finished goods. Only vendors approved for the product, size, class and finish can be chosen.</p>
      <DataTable rows={rows} empty="No SO line has a bought quantity." columns={[
        { key: 'so', label: 'SO', render: r => <Code>{r.o.no}</Code> },
        { key: 'it', label: 'Item', render: r => item(db, r.l.itemId).name },
        { key: 'b', label: 'Bought', align: 'right', render: r => `${num(r.l.qtyPcs - r.l.inhousePcs)} pcs` },
        { key: 's', label: 'Arrives as', render: r => r.l.boughtStage },
        { key: 'why', label: 'Why', render: r => <span className="muted">{r.l.splitReason}</span> },
        { key: 'vendor', label: 'On order with vendor', align: 'right', render: r => `${num(lineProgress(db, r.o.id, r.l.id).steps[2].value)} pcs` },
        { key: 'pos', label: 'POs', render: r => db.pos.filter(p => p.soId === r.o.id && p.kind === 'Outsourced' && p.lines[0].itemId === r.l.itemId).map(p => p.no).join(', ') || '—' },
      ]} actions={r => <Button small variant="soft" onClick={() => setPo({ soId: r.o.id, lineId: r.l.id })}>Outsource PO</Button>} />
      {po && (
        <FormModal title="Outsource PO" onClose={() => setPo(null)} submitLabel="Raise PO" initial={{ vendorId: 's5', rate: 90 }}
          fields={[
            { key: 'vendorId', label: 'Approved vendor', type: 'select', required: true, options: db.parties.filter(p => p.type === 'Supplier' && ['s3', 's5'].includes(p.id)).map(p => ({ value: p.id, label: p.name })) },
            { key: 'rate', label: 'Landed rate (₹/kg)', type: 'number', required: true, step: '0.1' },
          ]}
          onSubmit={v => { const r = act(d => createOutsourcePo(d, po.soId, po.lineId, v.vendorId, Number(v.rate))); if (r) return r; notify('Outsource PO raised and sent for approval'); }} />
      )}
    </>
  );
}

function FollowUp() {
  const db = useDB();
  const open = db.pos.filter(p => p.status === 'Open');
  const byVendor = [...new Set(open.map(p => p.vendorId))].map(v => {
    const ps = open.filter(p => p.vendorId === v);
    return { id: v, vendor: party(db, v).name, open: ps.length, overdue: ps.filter(p => p.due < today()).length, dueSoon: ps.filter(p => p.due >= today() && p.due <= addDays(today(), 3)).length, value: ps.reduce((s, p) => s + p.value, 0), rating: party(db, v).rating };
  });
  return <DataTable rows={byVendor} empty="No open POs." columns={[
    { key: 'v', label: 'Vendor', render: r => r.vendor },
    { key: 'o', label: 'Open POs', align: 'right', render: r => r.open },
    { key: 'd', label: 'Due in 3 days', align: 'right', render: r => r.dueSoon || '—' },
    { key: 'od', label: 'Overdue', align: 'right', render: r => r.overdue ? <strong className="tone-red">{r.overdue}</strong> : '—' },
    { key: 'val', label: 'Open value', align: 'right', render: r => inr(r.value) },
    { key: 'r', label: 'Rating', align: 'right', render: r => r.rating ?? '—' },
  ]} />;
}
