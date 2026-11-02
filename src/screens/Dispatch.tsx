import { useState } from 'react';
import { AlertTriangle, Package, ClipboardCheck, FileBadge, Truck, Receipt, Tag } from 'lucide-react';
import { useDB, act } from '../data/store';
import { PageHead, Code, Qr, StepBars } from '../components/shell';
import { Button, Badge, DataTable, Modal, Tabs, notify } from '../components/ui';
import { num, kgs, niceDate, inr, inr2 } from '../lib/format';
import { dispatchCap, pcsFromKg } from '../lib/plant';
import { packLots, offerTpi, recordTpi, requestMdcc, dispatchPacks, invoiceDispatch, lineCounts, item, party, GST_PCT } from '../lib/actions';
import { positions } from '../lib/inventory';
import { lineProgress, inPlant } from '../lib/metrics';
import type { Pack } from '../data/types';

type Tab = 'pack' | 'packs' | 'tpi' | 'mdcc' | 'dispatch' | 'invoice';

export function Dispatch() {
  const db = useDB();
  const lines = inPlant(db).orders.filter(o => !['Draft', 'Short-closed'].includes(o.status)).flatMap(o => o.lines.map(l => ({ o, l })));
  // Open on the line with the most going on, so the first view shows the whole chain.
  const busiest = [...lines].sort((a, b) => db.packs.filter(p => p.lineId === b.l.id).length - db.packs.filter(p => p.lineId === a.l.id).length)[0];
  const [key, setKey] = useState(busiest ? `${busiest.o.id}|${busiest.l.id}` : '');
  const [tab, setTab] = useState<Tab>('packs');
  const sel = lines.find(x => `${x.o.id}|${x.l.id}` === key);
  if (!sel) return <><PageHead title="Pack, dispatch & bill" /><div className="empty">No approved sales order to dispatch.</div></>;
  const { o, l } = sel;
  const p = lineProgress(db, o.id, l.id);
  const c = lineCounts(db, o.id, l.id);
  return (
    <>
      <PageHead title="Pack, dispatch & bill" sub="Each step caps the next: packed, TPI, MDCC, dispatched, invoiced. Nothing leaves without a packing list, TPI where required, and an MDCC.">
        <div className="field" style={{ maxWidth: 640 }}>
          <label htmlFor="dl">Sales order line</label>
          <select id="dl" value={key} onChange={e => setKey(e.target.value)}>
            {lines.map(x => <option key={x.l.id} value={`${x.o.id}|${x.l.id}`}>{x.o.no} · {party(db, x.o.customerId).name} · {item(db, x.l.itemId).name} · {num(x.l.qtyPcs)} pcs</option>)}
          </select>
        </div>
      </PageHead>
      <div className="panel"><StepBars steps={p.steps.slice(4)} total={l.qtyPcs} /></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'pack', label: 'Pack', icon: <Package size={15} /> },
        { id: 'packs', label: 'Packs & labels', count: db.packs.filter(x => x.lineId === l.id).length, icon: <Tag size={15} /> },
        { id: 'tpi', label: 'TPI', icon: <ClipboardCheck size={15} /> },
        { id: 'mdcc', label: 'MDCC', icon: <FileBadge size={15} /> },
        { id: 'dispatch', label: 'Dispatch', icon: <Truck size={15} /> },
        { id: 'invoice', label: 'Invoices', icon: <Receipt size={15} /> },
      ]} />
      {tab === 'pack' && <PackTab soId={o.id} lineId={l.id} />}
      {tab === 'packs' && <PacksTab lineId={l.id} />}
      {tab === 'tpi' && (o.tpi ? <TpiTab soId={o.id} lineId={l.id} /> : <div className="empty">{o.no} does not need third-party inspection. The step is skipped and the skip is recorded.</div>)}
      {tab === 'mdcc' && (o.mdcc ? <MdccTab soId={o.id} lineId={l.id} /> : <div className="empty">{o.no} does not need an MDCC. The step is skipped and the skip is recorded.</div>)}
      {tab === 'dispatch' && <DispatchTab soId={o.id} lineId={l.id} cap={dispatchCap(l.qtyPcs, o.tolerancePct, c.dispatched)} />}
      {tab === 'invoice' && <InvoiceTab lineId={l.id} />}
    </>
  );
}

function PackTab({ soId, lineId }: { soId: string; lineId: string }) {
  const db = useDB();
  const o = db.orders.find(x => x.id === soId)!; const l = o.lines.find(x => x.id === lineId)!; const it = item(db, l.itemId);
  const ready = db.lots.filter(x => x.itemId === l.itemId && x.stage === 'GALV' && x.soId === soId && positions(db, x.no).some(p => p.stage === 'GALV'));
  const [sel, setSel] = useState<string[]>([]);
  const [error, setError] = useState('');
  return (
    <div className="panel">
      <p className="muted">Packing instructions from the SO: <strong>{o.packing}</strong>. Each 25 kg bag holds {num(pcsFromKg(it, 25))} pcs of {it.name}.</p>
      <ul className="check-list" style={{ marginTop: 10 }}>
        {ready.length === 0 && <li className="muted">No galvanised lots of this item are waiting for packing.</li>}
        {ready.map(x => {
          const b = x.batchId ? db.batches.find(y => y.id === x.batchId) : undefined;
          return (
            <li key={x.no}><label className={sel.includes(x.no) ? 'is-on' : ''}>
              <input type="checkbox" checked={sel.includes(x.no)} onChange={e => setSel(s => e.target.checked ? [...s, x.no] : s.filter(n => n !== x.no))} />
              <span><Code>{x.no}</Code> {b ? `from ${b.no}` : 'bought finished'} {b && b.status !== 'Handed to packing' && <Badge tone="gold">{b.status}</Badge>}</span>
              <span className="muted small">{num(x.pcs)} pcs, {num(x.kg)} kg</span>
            </label></li>
          );
        })}
      </ul>
      <div className="row" style={{ marginTop: 10 }}>
        <Button variant="signal" disabled={!sel.length} onClick={() => {
          const r = act(d => packLots(d, soId, lineId, sel));
          if (r) setError(r); else { setSel([]); setError(''); notify('Packed; QR labels are ready under Packs & labels'); }
        }}>Pack selected lots</Button>
      </div>
      {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
    </div>
  );
}

function PacksTab({ lineId }: { lineId: string }) {
  const db = useDB();
  const [label, setLabel] = useState<Pack | null>(null);
  const packs = db.packs.filter(p => p.lineId === lineId).map(p => ({ ...p, id: p.no }));
  return (
    <>
      <DataTable rows={packs} pageSize={12} onRowClick={setLabel} columns={[
        { key: 'no', label: 'Pack', render: p => <Code>{p.no}</Code> },
        { key: 'l', label: 'Lot', render: p => p.lots.map(n => <Code key={n}>{n}</Code>) },
        { key: 'pcs', label: 'pcs', align: 'right', render: p => num(p.pcs) },
        { key: 'kg', label: 'Net / gross kg', align: 'right', render: p => `${num(p.netKg, 2)} / ${num(p.grossKg, 2)}` },
        { key: 's', label: 'State', render: p => <Badge tone={p.state === 'Dispatched' ? 'green' : p.state === 'TPI accepted' ? 'blue' : p.state === 'TPI rejected' ? 'red' : 'grey'}>{p.state}</Badge> },
      ]} actions={p => <Button small variant="ghost" icon={<Tag size={14} />} onClick={() => setLabel(p)}>Label</Button>} />
      {label && <PackLabel pack={label} onClose={() => setLabel(null)} />}
    </>
  );
}

export function PackLabel({ pack, onClose }: { pack: Pack; onClose: () => void }) {
  const db = useDB();
  const o = db.orders.find(x => x.id === pack.soId)!; const it = item(db, pack.itemId);
  return (
    <Modal title={`Pack label ${pack.no}`} subtitle="Scanned on loading and at the customer; the QR opens the full trace." onClose={onClose}>
      <div className="label-card">
        <Qr text={pack.no} size={96} />
        <div>
          <strong>{it.name}</strong>
          <dl>
            <dt>Pack</dt><dd className="code">{pack.no}</dd>
            <dt>Standard</dt><dd>{it.standard}, {it.finish}</dd>
            <dt>Lots</dt><dd className="code">{pack.lots.join(', ')}</dd>
            <dt>Pieces</dt><dd>{num(pack.pcs)}</dd>
            <dt>Net / gross</dt><dd>{num(pack.netKg, 2)} / {num(pack.grossKg, 2)} kg</dd>
            <dt>SO / PO</dt><dd className="code">{o.no} / {o.clientPo}</dd>
          </dl>
        </div>
      </div>
    </Modal>
  );
}

function TpiTab({ soId, lineId }: { soId: string; lineId: string }) {
  const db = useDB();
  const packed = db.packs.filter(p => p.lineId === lineId && p.state === 'Packed');
  const tpis = db.tpis.filter(t => t.lineId === lineId);
  const [result, setResult] = useState<string | null>(null);
  const [reject, setReject] = useState<string[]>([]);
  const [report, setReport] = useState('');
  const [error, setError] = useState('');
  const agencies = db.parties.filter(p => p.type === 'TPI agency');
  const [agency, setAgency] = useState(agencies[0].id);
  return (
    <div className="stack">
      <div className="panel">
        <div className="row"><strong>{packed.length} packs ({num(packed.reduce((s, p) => s + p.pcs, 0))} pcs) packed and not yet offered</strong><span className="grow" />
          <select className="select-inline" value={agency} onChange={e => setAgency(e.target.value)} aria-label="Inspection agency">{agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <Button variant="signal" disabled={!packed.length} onClick={() => { const r = act(d => offerTpi(d, soId, lineId, packed.map(p => p.no), agency)); if (r) setError(r); else notify('Call letter raised; packs offered for inspection'); }}>Offer all for TPI</Button>
        </div>
        <p className="muted small">Only packs from galvanising batches that passed coating QC can be offered.</p>
      </div>
      <DataTable rows={tpis} empty="No inspection offered yet." columns={[
        { key: 'no', label: 'Call', render: t => <div className="cell2"><Code>{t.no}</Code><small>{niceDate(t.date)}</small></div> },
        { key: 'a', label: 'Agency', render: t => party(db, t.agencyId).name },
        { key: 'o', label: 'Offered', align: 'right', render: t => num(t.offeredPcs) },
        { key: 'ac', label: 'Accepted', align: 'right', render: t => t.status === 'Done' ? num(t.acceptedPcs) : '—' },
        { key: 'rj', label: 'Rejected', align: 'right', render: t => t.status === 'Done' ? (t.rejectedPcs ? <span className="tone-red">{num(t.rejectedPcs)}</span> : '0') : '—' },
        { key: 'r', label: 'Report', render: t => t.report ? <Code>{t.report}</Code> : <Badge tone="gold">Awaiting inspection</Badge> },
      ]} actions={t => t.status === 'Offered' ? <Button small variant="soft" onClick={() => { setResult(t.id); setReject([]); setReport(''); }}>Record result</Button> : null} />
      {result && (() => {
        const t = db.tpis.find(x => x.id === result)!;
        return (
          <Modal title={`Inspection result, ${t.no}`} subtitle="Tick any pack the inspector rejected." onClose={() => setResult(null)} wide
            footer={<><Button variant="ghost" onClick={() => setResult(null)}>Cancel</Button><Button onClick={() => { const r = act(d => recordTpi(d, t.id, reject, report)); if (r) setError(r); else { notify('Inspection recorded'); setResult(null); } }}>Save result</Button></>}>
            <div className="field"><label htmlFor="tpi-r">Inspection report no.</label><input id="tpi-r" value={report} onChange={e => setReport(e.target.value)} /></div>
            <ul className="check-list" style={{ marginTop: 12 }}>
              {t.packs.map(n => <li key={n}><label className={reject.includes(n) ? 'is-on' : ''}><input type="checkbox" checked={reject.includes(n)} onChange={e => setReject(s => e.target.checked ? [...s, n] : s.filter(x => x !== n))} /><Code>{n}</Code><span className="muted small">{num(db.packs.find(p => p.no === n)!.pcs)} pcs</span></label></li>)}
            </ul>
            {error && <div className="form-error">{error}</div>}
          </Modal>
        );
      })()}
      {error && !result && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
    </div>
  );
}

function MdccTab({ soId, lineId }: { soId: string; lineId: string }) {
  const db = useDB();
  const o = db.orders.find(x => x.id === soId)!;
  const c = lineCounts(db, soId, lineId);
  const room = (o.tpi ? c.tpiAccepted : c.packed) - c.mdcc;
  const [pcs, setPcs] = useState(room);
  const [no, setNo] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="stack">
      <div className="panel">
        <div className="calc-strip"><span>{o.tpi ? 'TPI accepted' : 'Packed'}<strong>{num(o.tpi ? c.tpiAccepted : c.packed)} pcs</strong></span><span>Under MDCC<strong>{num(c.mdcc)} pcs</strong></span><span>Can request<strong>{num(Math.max(0, room))} pcs</strong></span></div>
        <div className="form-grid form-grid--3" style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor="md-n">MDCC no. from customer</label><input id="md-n" value={no} onChange={e => setNo(e.target.value)} /></div>
          <div className="field"><label htmlFor="md-q">Quantity (pcs)</label><input id="md-q" type="number" value={pcs || ''} onChange={e => setPcs(Number(e.target.value))} /></div>
          <div className="field" style={{ justifyContent: 'flex-end' }}><Button onClick={() => { const r = act(d => requestMdcc(d, soId, lineId, pcs, no)); if (r) setError(r); else { setError(''); setNo(''); notify('MDCC recorded; quantity is cleared for dispatch'); } }}>Record MDCC</Button></div>
        </div>
        {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
      </div>
      <DataTable rows={db.mdccs.filter(m => m.lineId === lineId)} empty="No MDCC yet." columns={[
        { key: 'no', label: 'MDCC', render: m => <Code>{m.no}</Code> },
        { key: 'd', label: 'Date', render: m => niceDate(m.date) },
        { key: 'v', label: 'Valid till', render: m => niceDate(m.validTill) },
        { key: 'q', label: 'Cleared', align: 'right', render: m => num(m.pcs) },
        { key: 'u', label: 'Dispatched against it', align: 'right', render: m => num(m.usedPcs) },
        { key: 'b', label: 'Balance', align: 'right', render: m => <strong>{num(m.pcs - m.usedPcs)}</strong> },
      ]} />
    </div>
  );
}

function DispatchTab({ soId, lineId, cap }: { soId: string; lineId: string; cap: number }) {
  const db = useDB();
  const o = db.orders.find(x => x.id === soId)!;
  const c = lineCounts(db, soId, lineId);
  const ready = db.packs.filter(p => p.lineId === lineId && p.state === (o.tpi ? 'TPI accepted' : 'Packed'));
  const [sel, setSel] = useState<string[]>([]);
  const [v, setV] = useState({ vehicle: '', transporter: '', lr: '', ewayBill: '' });
  const [error, setError] = useState('');
  const pcs = ready.filter(p => sel.includes(p.no)).reduce((s, p) => s + p.pcs, 0);
  const limit = Math.min(cap, o.mdcc ? c.mdccBalance : Infinity);
  return (
    <div className="stack">
      <div className="panel">
        <div className={`calc-strip${pcs > limit ? ' calc-strip--bad' : ''}`}>
          {o.mdcc && <span>MDCC balance<strong>{num(c.mdccBalance)} pcs</strong></span>}
          <span>SO balance incl. ±{o.tolerancePct}%<strong>{num(cap)} pcs</strong></span>
          <span>Loading now<strong>{num(pcs)} pcs, {sel.length} packs</strong></span>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <Button small variant="ghost" onClick={() => { let t = 0; const pick: string[] = []; for (const p of ready) { if (t + p.pcs > limit) break; t += p.pcs; pick.push(p.no); } setSel(pick); }}>Scan packs up to the limit</Button>
          <Button small variant="ghost" onClick={() => setSel([])}>Clear</Button>
          <span className="muted small">{ready.length} packs ready to load</span>
        </div>
        <ul className="check-list" style={{ marginTop: 8, maxHeight: 220 }}>
          {ready.map(p => <li key={p.no}><label className={sel.includes(p.no) ? 'is-on' : ''}><input type="checkbox" checked={sel.includes(p.no)} onChange={e => setSel(s => e.target.checked ? [...s, p.no] : s.filter(x => x !== p.no))} /><Code>{p.no}</Code><span className="muted small">{num(p.pcs)} pcs</span></label></li>)}
        </ul>
        <div className="form-grid" style={{ marginTop: 12 }}>
          {([['vehicle', 'Vehicle no.'], ['transporter', 'Transporter'], ['lr', 'LR no.'], ['ewayBill', 'E-way bill']] as const).map(([k, label]) => (
            <div className="field" key={k}><label htmlFor={`dc-${k}`}>{label}</label><input id={`dc-${k}`} value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })} /></div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Button variant="signal" icon={<Truck size={15} />} onClick={() => { const r = act(d => dispatchPacks(d, { soId, lineId, packNos: sel, ...v })); if (r) setError(r); else { setSel([]); setError(''); notify('Dispatched; delivery challan ready. Raise the invoice under Invoices.'); } }}>Dispatch</Button>
        </div>
        {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
      </div>
      <DataTable rows={db.dispatches.filter(d => d.lineId === lineId)} empty="Nothing dispatched yet." columns={[
        { key: 'no', label: 'Challan', render: d => <Code>{d.no}</Code> },
        { key: 'dt', label: 'Date', render: d => niceDate(d.date) },
        { key: 'v', label: 'Vehicle / LR', render: d => <div className="cell2"><span>{d.vehicle}</span><small>{d.transporter}, LR {d.lr}</small></div> },
        { key: 'p', label: 'Packs', align: 'right', render: d => d.packs.length },
        { key: 'q', label: 'pcs / kg', align: 'right', render: d => `${num(d.pcs)} / ${num(d.kg)}` },
      ]} />
    </div>
  );
}

function InvoiceTab({ lineId }: { lineId: string }) {
  const db = useDB();
  const ds = db.dispatches.filter(d => d.lineId === lineId);
  return (
    <DataTable rows={ds} empty="Nothing dispatched yet." columns={[
      { key: 'dc', label: 'Challan', render: d => <Code>{d.no}</Code> },
      { key: 'q', label: 'pcs', align: 'right', render: d => num(d.pcs) },
      { key: 'inv', label: 'Invoice', render: d => { const i = db.invoices.find(x => x.dispatchId === d.id); return i ? <Code>{i.no}</Code> : <Badge tone="gold">Not invoiced</Badge>; } },
      { key: 't', label: 'Taxable', align: 'right', render: d => { const i = db.invoices.find(x => x.dispatchId === d.id); return i ? inr2(i.taxable) : '—'; } },
      { key: 'g', label: `GST ${GST_PCT}%`, align: 'right', render: d => { const i = db.invoices.find(x => x.dispatchId === d.id); return i ? inr2(i.gst) : '—'; } },
      { key: 'tot', label: 'Total', align: 'right', render: d => { const i = db.invoices.find(x => x.dispatchId === d.id); return i ? <strong>{inr(i.total)}</strong> : '—'; } },
    ]} actions={d => db.invoices.some(i => i.dispatchId === d.id) ? null : <Button small variant="soft" onClick={() => { const r = act(x => invoiceDispatch(x, d.id)); if (r) notify(r, 'warn'); else notify('Invoice raised at SO rates'); }}>Raise invoice</Button>} />
  );
}

