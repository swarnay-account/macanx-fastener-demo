import { useState } from 'react';
import { Plus, CheckCircle2, AlertTriangle, XCircle, ShieldAlert, Trash2 } from 'lucide-react';
import { useDB, act } from '../data/store';
import { PageHead, Code, StockBadge } from '../components/shell';
import { Button, Badge, DataTable, Modal, Tabs, KV, notify, type Tone } from '../components/ui';
import { kgs, niceDate, num } from '../lib/format';
import { weighbridgeVariance } from '../lib/plant';
import { receiveGrn, qcDecision, tcCheck, item, party } from '../lib/actions';
import type { Grn, GrnLine } from '../data/types';

const QC_TONE: Record<Grn['qc'], Tone> = { 'Quality hold': 'gold', Accepted: 'green', 'Accepted with deviation': 'blue', Rejected: 'red' };

export function Inward() {
  const db = useDB();
  const [tab, setTab] = useState<'qc' | 'grn'>('qc');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const hold = db.grns.filter(g => g.qc === 'Quality hold');
  return (
    <>
      <PageHead title="Inward & QC" sub="Nothing is used until QC clears it. A GRN can only be made from a gate entry against an approved PO."
        actions={<Button variant="signal" icon={<Plus size={16} />} onClick={() => setAdding(true)}>Gate entry & GRN</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'qc', label: 'Waiting for QC', count: hold.length }, { id: 'grn', label: 'GRN register', count: db.grns.length }]} />
      <DataTable rows={tab === 'qc' ? hold : db.grns} onRowClick={g => setOpen(g.id)} empty="Nothing is waiting for incoming QC." columns={[
        { key: 'no', label: 'GRN', render: g => <div className="cell2"><Code>{g.no}</Code><small>{niceDate(g.date)}</small></div> },
        { key: 'v', label: 'Vendor', render: g => party(db, g.vendorId).name },
        { key: 'i', label: 'Material', render: g => item(db, db.pos.find(p => p.id === g.poId)!.lines[0].itemId).name },
        { key: 'h', label: 'Heats / batches', render: g => g.lines.map(l => <Code key={l.heatNo}>{l.heatNo} </Code>) },
        { key: 'kg', label: 'Received', align: 'right', render: g => kgs(g.lines.reduce((s, l) => s + l.kg, 0)) },
        { key: 'wb', label: 'Weighbridge', align: 'right', render: g => { const w = weighbridgeVariance(g.invoiceKg, g.grossKg, g.tareKg); return <span className={Math.abs(w.pct) > 2 ? 'tone-red' : ''}>{w.pct > 0 ? '+' : ''}{w.pct}%</span>; } },
        { key: 'qc', label: 'QC', render: g => <Badge tone={QC_TONE[g.qc]}>{g.qc}</Badge> },
      ]} actions={g => g.qc === 'Quality hold' ? <Button small variant="soft" onClick={() => setOpen(g.id)}>Inspect</Button> : null} />
      {adding && <GrnForm onClose={() => setAdding(false)} />}
      {open && <QcModal grn={db.grns.find(g => g.id === open)!} onClose={() => setOpen(null)} />}
    </>
  );
}

function QcModal({ grn, onClose }: { grn: Grn; onClose: () => void }) {
  const db = useDB();
  const po = db.pos.find(p => p.id === grn.poId)!;
  const it = item(db, po.lines[0].itemId);
  const tc = tcCheck(db, grn);
  const grade = db.grades.find(g => g.name === it.grade);
  const wb = weighbridgeVariance(grn.invoiceKg, grn.grossKg, grn.tareKg);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [checks, setChecks] = useState({ dia: true, ovality: true, surface: true, hardness: true });
  const decideQc = (d: 'Accept' | 'Deviation' | 'Reject') => {
    if (d === 'Accept' && Object.values(checks).some(v => !v)) { setError('A physical check failed. Accept with deviation or reject.'); return; }
    const r = act(x => qcDecision(x, grn.id, d, note));
    if (r) { setError(r); return; }
    notify(d === 'Accept' ? `${grn.no} accepted; stock is ${grn.soId ? 'reserved for the order' : 'free'}` : d === 'Deviation' ? 'Deviation sent to the QC head' : `${grn.no} rejected; debit note raised`);
    onClose();
  };
  return (
    <Modal title={`${grn.no}: incoming inspection`} subtitle={`${it.name} from ${party(db, grn.vendorId).name}`} wide onClose={onClose}
      footer={grn.qc === 'Quality hold' ? <>
        <Button variant="ghost" icon={<XCircle size={15} />} onClick={() => decideQc('Reject')}>Reject</Button>
        <Button variant="ghost" icon={<ShieldAlert size={15} />} onClick={() => decideQc('Deviation')}>Accept with deviation</Button>
        <Button variant="signal" icon={<CheckCircle2 size={15} />} onClick={() => decideQc('Accept')}>Accept</Button>
      </> : <Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="stack">
        <KV items={[
          ['PO', <Code>{po.no}</Code>], ['Vehicle', grn.vehicle], ['Invoice', grn.invoiceNo], ['E-way bill', grn.ewayBill],
          ['Invoice weight', kgs(grn.invoiceKg)], ['Weighbridge net', `${kgs(wb.net)} (${wb.pct > 0 ? '+' : ''}${wb.pct}%)`],
          ['For', grn.soId ? db.orders.find(o => o.id === grn.soId)!.no : 'Free stock'], ['QC status', <Badge tone={QC_TONE[grn.qc]}>{grn.qc}</Badge>],
        ]} />
        <table className="table table--compact">
          <thead><tr><th>Heat / batch</th><th>Coils</th><th style={{ textAlign: 'right' }}>kg</th><th style={{ textAlign: 'right' }}>pcs</th></tr></thead>
          <tbody>{grn.lines.map(l => <tr key={l.heatNo}><td><Code>{l.heatNo}</Code></td><td>{l.coils || '—'}</td><td style={{ textAlign: 'right' }}>{num(l.kg)}</td><td style={{ textAlign: 'right' }}>{l.pcs ? num(l.pcs) : '—'}</td></tr>)}</tbody>
        </table>
        <div className="grid-2">
          <div className="panel" style={{ padding: 12 }}>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>Mill TC against {it.grade ?? 'spec'}</h3>
            {grade ? (
              <table className="table table--compact">
                <thead><tr><th>Element</th><th>TC</th><th>Limit</th></tr></thead>
                <tbody>
                  <tr><td>Carbon %</td><td>{grn.tc.c}</td><td>{grade.c}</td></tr>
                  <tr><td>Manganese %</td><td>{grn.tc.mn}</td><td>{grade.mn}</td></tr>
                  {grade.b && <tr><td>Boron %</td><td>{grn.tc.b}</td><td>{grade.b}</td></tr>}
                  <tr><td>Tensile MPa</td><td>{grn.tc.tensile}</td><td>{grade.tensile}</td></tr>
                </tbody>
              </table>
            ) : <p className="muted small">Bought goods: vendor TC and test report checked against the property class and finish.</p>}
            <p className={`small ${tc.ok ? 'tone-green' : 'tone-red'}`} style={{ marginTop: 8 }}>{tc.ok ? 'Heat numbers matched; chemistry and mechanicals within limits.' : tc.notes.join('; ')}</p>
          </div>
          <div className="panel" style={{ padding: 12 }}>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>Physical checks</h3>
            <div className="form-grid form-grid--1">
              {([['dia', 'Diameter within tolerance'], ['ovality', 'Ovality'], ['surface', 'Surface condition'], ['hardness', 'Sample hardness']] as const).map(([k, label]) => (
                <label key={k} className="field field--check"><input type="checkbox" checked={checks[k]} disabled={grn.qc !== 'Quality hold'} onChange={e => setChecks(c => ({ ...c, [k]: e.target.checked }))} />{label} OK</label>
              ))}
            </div>
          </div>
        </div>
        {grn.qc === 'Quality hold' && <div className="field"><label htmlFor="qc-note">Remarks / deviation</label><textarea id="qc-note" rows={2} value={note} onChange={e => setNote(e.target.value)} /></div>}
        {grn.qcNote && <p className="muted small">QC remark: {grn.qcNote}</p>}
        {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
        <p className="muted small">Stock status now: <StockBadge status={grn.qc === 'Quality hold' ? 'Quality hold' : grn.qc === 'Rejected' ? 'Rejected' : grn.soId ? 'Reserved' : 'Free'} /></p>
      </div>
    </Modal>
  );
}

function GrnForm({ onClose }: { onClose: () => void }) {
  const db = useDB();
  const open = db.pos.filter(p => p.status === 'Open');
  const [poId, setPoId] = useState(open[0]?.id ?? '');
  const po = db.pos.find(p => p.id === poId);
  const [g, setG] = useState({ vehicle: '', invoiceNo: '', ewayBill: '', invoiceKg: 0, grossKg: 0, tareKg: 0, c: 0.2, mn: 0.8, b: 0.0015, tensile: 500 });
  const [lines, setLines] = useState<GrnLine[]>([{ itemId: '', heatNo: '', coils: 1, kg: 0 }]);
  const [error, setError] = useState('');
  const wb = weighbridgeVariance(g.invoiceKg, g.grossKg, g.tareKg);
  const flagged = po && g.invoiceKg > 0 && g.grossKg > 0 && Math.abs(wb.pct) > po.tolerancePct;
  if (!open.length) return <Modal title="Gate entry & GRN" onClose={onClose}><p className="muted">There is no open, approved PO to receive against.</p></Modal>;
  const save = () => {
    if (!po) return;
    const r = act(d => receiveGrn(d, { poId, vehicle: g.vehicle, invoiceNo: g.invoiceNo, ewayBill: g.ewayBill, invoiceKg: g.invoiceKg, grossKg: g.grossKg, tareKg: g.tareKg,
      lines: lines.filter(l => l.heatNo && l.kg > 0).map(l => ({ ...l, itemId: po.lines[0].itemId })), tc: { c: g.c, mn: g.mn, b: g.b, tensile: g.tensile } }));
    if (typeof r === 'string') { setError(r); return; }
    notify(`${r.grn.no} saved on quality hold${r.flagged ? '. Weighbridge variance flagged.' : ''}`, r.flagged ? 'warn' : 'ok');
    onClose();
  };
  const num2 = (k: keyof typeof g) => ({ type: 'number', value: g[k] || '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setG({ ...g, [k]: Number(e.target.value) }) });
  return (
    <Modal title="Gate entry & GRN" subtitle="The material goes on quality hold until QC records a result." wide onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save GRN</Button></>}>
      <div className="stack">
        <div className="form-grid form-grid--3">
          <div className="field field--full"><label htmlFor="g-po">Against PO</label><select id="g-po" value={poId} onChange={e => setPoId(e.target.value)}>
            {open.map(p => <option key={p.id} value={p.id}>{p.no} · {party(db, p.vendorId).name} · {item(db, p.lines[0].itemId).name} · balance {kgs(p.lines[0].qtyKg - p.lines[0].receivedKg)}</option>)}</select></div>
          <div className="field"><label htmlFor="g-v">Vehicle no.</label><input id="g-v" value={g.vehicle} onChange={e => setG({ ...g, vehicle: e.target.value })} placeholder="GJ03 AB 1234" /></div>
          <div className="field"><label htmlFor="g-i">Invoice no.</label><input id="g-i" value={g.invoiceNo} onChange={e => setG({ ...g, invoiceNo: e.target.value })} /></div>
          <div className="field"><label htmlFor="g-e">E-way bill</label><input id="g-e" value={g.ewayBill} onChange={e => setG({ ...g, ewayBill: e.target.value })} /></div>
          <div className="field"><label htmlFor="g-ik">Invoice weight (kg)</label><input id="g-ik" {...num2('invoiceKg')} /></div>
          <div className="field"><label htmlFor="g-gr">Weighbridge gross (kg)</label><input id="g-gr" {...num2('grossKg')} /></div>
          <div className="field"><label htmlFor="g-ta">Tare (kg)</label><input id="g-ta" {...num2('tareKg')} /></div>
        </div>
        {g.grossKg > 0 && <div className={`calc-strip${flagged ? ' calc-strip--bad' : ''}`}><span>Net<strong>{kgs(wb.net)}</strong></span><span>Difference vs invoice<strong>{wb.diffKg > 0 ? '+' : ''}{kgs(wb.diffKg)} ({wb.pct}%)</strong></span>{flagged && <span>Beyond the PO tolerance of {po!.tolerancePct}%: will be flagged</span>}</div>}
        <h3 style={{ fontSize: 16 }}>Coils / batches from the mill tag</h3>
        {lines.map((l, i) => (
          <div className="form-grid form-grid--3" key={i}>
            <div className="field"><label>Heat no.</label><input value={l.heatNo} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, heatNo: e.target.value.toUpperCase() } : x))} /></div>
            <div className="field"><label>Coils</label><input type="number" value={l.coils} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, coils: Number(e.target.value) } : x))} /></div>
            <div className="field"><label>kg</label><div className="picker"><input type="number" value={l.kg || ''} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, kg: Number(e.target.value) } : x))} />
              {lines.length > 1 && <button className="icon-btn icon-btn--box" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={15} /></button>}</div></div>
          </div>
        ))}
        <div><Button small variant="ghost" icon={<Plus size={14} />} onClick={() => setLines(ls => [...ls, { itemId: '', heatNo: '', coils: 1, kg: 0 }])}>Add heat</Button></div>
        <h3 style={{ fontSize: 16 }}>Mill TC values</h3>
        <div className="form-grid form-grid--3">
          <div className="field"><label>C %</label><input type="number" step="0.01" value={g.c} onChange={e => setG({ ...g, c: Number(e.target.value) })} /></div>
          <div className="field"><label>Mn %</label><input type="number" step="0.01" value={g.mn} onChange={e => setG({ ...g, mn: Number(e.target.value) })} /></div>
          <div className="field"><label>B %</label><input type="number" step="0.0001" value={g.b} onChange={e => setG({ ...g, b: Number(e.target.value) })} /></div>
          <div className="field"><label>Tensile MPa</label><input type="number" value={g.tensile} onChange={e => setG({ ...g, tensile: Number(e.target.value) })} /></div>
        </div>
        {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
      </div>
    </Modal>
  );
}
