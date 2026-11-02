import { useState } from 'react';
import { Plus, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import { useDB, act } from '../data/store';
import { PageHead, Code } from '../components/shell';
import { Button, Badge, DataTable, Modal, FormModal, Tabs, Stat, notify, type Tone } from '../components/ui';
import { num, kgs, niceDate } from '../lib/format';
import { zincPickup, zincInBand, ZINC_BAND, COATING_SPEC, stockOf } from '../lib/plant';
import { createBatch, postGi, handoverBatch, item, machine, giReadyStage } from '../lib/actions';
import { positions } from '../lib/inventory';
import { inPlant, giByKettle } from '../lib/metrics';
import type { GiBatch } from '../data/types';

const B_TONE: Record<GiBatch['status'], Tone> = { 'In kettle': 'gold', Passed: 'blue', 'Re-dip': 'red', 'Handed to packing': 'green' };

export function Galvanising() {
  const db = useDB();
  const [tab, setTab] = useState<'batches' | 'zinc'>('batches');
  const [creating, setCreating] = useState(false);
  const [posting, setPosting] = useState<GiBatch | null>(null);
  const { batches } = inPlant(db);
  const kettles = giByKettle(db, 14);
  const zinc = stockOf(db.ledger, { itemId: 'con-zn' }).kg;
  return (
    <>
      <PageHead title="Galvanising" sub={`Batches of lots, checked before and after. Coating below ${COATING_SPEC.min} µm local or ${COATING_SPEC.avg} µm average blocks the batch from packing.`}
        actions={<Button variant="signal" icon={<Plus size={16} />} onClick={() => setCreating(true)}>New GI batch</Button>} />
      <div className="stats">
        {kettles.map(k => <Stat key={k.kettle.id} icon={null} label={`${k.kettle.code}, last 14 days`} value={`${num(k.kg)} kg`} sub={`${k.batches} batches, ${num(k.perDay)} kg a day; load limit ${num(k.kettle.loadLimitKg ?? 0)} kg`} />)}
        <Stat icon={null} label="Zinc ingot in stock" value={kgs(zinc)} sub={`Reorder at ${kgs(db.items.find(i => i.id === 'con-zn')!.reorderKg ?? 0)}`} tone={zinc < (db.items.find(i => i.id === 'con-zn')!.reorderKg ?? 0) ? 'red' : 'green'} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'batches', label: 'Batch register', count: batches.length }, { id: 'zinc', label: 'Zinc & chemicals' }]} />
      {tab === 'batches' ? (
        <DataTable rows={batches} pageSize={12} columns={[
          { key: 'no', label: 'Batch', render: b => <div className="cell2"><Code>{b.no}</Code><small>{niceDate(b.date)}, {b.shift}</small></div> },
          { key: 'k', label: 'Kettle', render: b => machine(db, b.kettleId).code },
          { key: 'l', label: 'Lots', render: b => b.lots.map(n => <Code key={n}>{n} </Code>) },
          { key: 'bw', label: 'Black → GI kg', align: 'right', render: b => `${num(b.blackKg)} → ${b.giKg ? num(b.giKg) : '…'}` },
          { key: 'zp', label: 'Zinc pick-up', align: 'right', render: b => { if (!b.giKg) return '—'; const p = zincPickup(b.blackKg, b.giKg); return <span className={zincInBand(p) ? '' : 'tone-red'}>{p}%</span>; } },
          { key: 'ct', label: 'Coating µm', align: 'right', render: b => b.coatingAvg ? <span className={b.post === 'Fail' ? 'tone-red' : ''}>{b.coatingMin} / {b.coatingAvg}</span> : '—' },
          { key: 'bath', label: 'Bath', render: b => <span className="muted small">{b.tempC} °C, dip {b.dipSec}s, spin {b.spinSec}s</span> },
          { key: 's', label: 'Status', render: b => <Badge tone={B_TONE[b.status]}>{b.status}</Badge> },
        ]} actions={b => b.status === 'In kettle' || b.status === 'Re-dip'
          ? <Button small variant="soft" onClick={() => setPosting(b)}>{b.status === 'Re-dip' ? 'Re-dip result' : 'Post-GI check'}</Button>
          : b.status === 'Passed' ? <Button small variant="ghost" icon={<ArrowRightLeft size={14} />} onClick={() => { const r = act(d => handoverBatch(d, b.id)); if (r) notify(r, 'warn'); else notify(`${b.no} handed over to packing`); }}>Hand to packing</Button> : null} />
      ) : (
        <DataTable rows={batches.filter(b => b.zincKg > 0)} columns={[
          { key: 'no', label: 'Batch', render: b => <Code>{b.no}</Code> },
          { key: 'd', label: 'Date', render: b => niceDate(b.date) },
          { key: 'pick', label: 'Zinc picked up', align: 'right', render: b => kgs(b.giKg - b.blackKg, 1) },
          { key: 'zn', label: 'Zinc issued (incl. dross & ash)', align: 'right', render: b => kgs(b.zincKg, 1) },
          { key: 'fl', label: 'Flux', align: 'right', render: b => kgs(b.blackKg * 0.004, 1) },
          { key: 'ac', label: 'Acid', align: 'right', render: b => kgs(b.blackKg * 0.012, 1) },
        ]} />
      )}
      {creating && <BatchForm onClose={() => setCreating(false)} />}
      {posting && <PostForm batch={posting} onClose={() => setPosting(null)} />}
    </>
  );
}

function BatchForm({ onClose }: { onClose: () => void }) {
  const db = useDB();
  const kettles = inPlant(db).machines.filter(m => m.type === 'GI kettle');
  const [kettleId, setKettle] = useState(kettles[0]?.id ?? '');
  const [sel, setSel] = useState<string[]>([]);
  const [pre, setPre] = useState({ surface: true, pickled: true, threads: true });
  const [bath, setBath] = useState({ tempC: 450, dipSec: 70, spinSec: 18 });
  const [error, setError] = useState('');
  const ready = db.lots.filter(l => {
    const stage = l.source === 'Bought' ? 'THREADED' : giReadyStage(db, l.itemId);
    return l.stage === stage && db.items.find(i => i.id === l.itemId)?.finish === 'HDG' && positions(db, l.no).some(p => p.stage === stage);
  });
  const kg = ready.filter(l => sel.includes(l.no)).reduce((s, l) => s + (positions(db, l.no).find(p => p.stage === l.stage)?.kg ?? 0), 0);
  const limit = machine(db, kettleId)?.loadLimitKg ?? 0;
  return (
    <Modal title="New GI batch" subtitle="Lots must have passed in-process QC. The batch cannot exceed the kettle's load limit." wide onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => {
        const r = act(d => createBatch(d, { kettleId, lotNos: sel, ...bath, prePass: Object.values(pre).every(Boolean) }));
        if (r) setError(r); else { notify('Batch loaded into the kettle'); onClose(); }
      }}>Load kettle</Button></>}>
      <div className="stack">
        <div className="form-grid form-grid--3">
          <div className="field"><label htmlFor="gb-k">Kettle</label><select id="gb-k" value={kettleId} onChange={e => setKettle(e.target.value)}>{kettles.map(k => <option key={k.id} value={k.id}>{k.code}, limit {num(k.loadLimitKg ?? 0)} kg</option>)}</select></div>
          <div className="field"><label htmlFor="gb-t">Bath °C</label><input id="gb-t" type="number" value={bath.tempC} onChange={e => setBath({ ...bath, tempC: Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="gb-d">Dip / spin seconds</label><div className="picker"><input id="gb-d" type="number" value={bath.dipSec} onChange={e => setBath({ ...bath, dipSec: Number(e.target.value) })} /><input type="number" aria-label="Spin seconds" value={bath.spinSec} onChange={e => setBath({ ...bath, spinSec: Number(e.target.value) })} /></div></div>
        </div>
        <div>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}><strong>Kettle load</strong><span className={kg > limit ? 'tone-red' : 'muted'}>{num(kg)} of {num(limit)} kg</span></div>
          <div className={`gauge${kg > limit ? ' is-over' : ''}`}><i style={{ width: `${Math.min(100, limit ? kg / limit * 100 : 0)}%` }} /></div>
        </div>
        <ul className="check-list">
          {ready.length === 0 && <li className="muted">No lots are ready for galvanising.</li>}
          {ready.map(l => {
            const p = positions(db, l.no).find(x => x.stage === l.stage)!;
            return (
              <li key={l.no}><label className={sel.includes(l.no) ? 'is-on' : ''}>
                <input type="checkbox" checked={sel.includes(l.no)} onChange={e => setSel(s => e.target.checked ? [...s, l.no] : s.filter(x => x !== l.no))} />
                <span><Code>{l.no}</Code> {item(db, l.itemId).name}{l.source === 'Bought' ? ' (bought black)' : ''} {l.ipqc !== 'Pass' && <Badge tone={l.ipqc === 'Fail' ? 'red' : 'grey'}>IPQC {l.ipqc.toLowerCase()}</Badge>}</span>
                <span className="muted small">{num(p.pcs)} pcs, {num(p.kg)} kg</span>
              </label></li>
            );
          })}
        </ul>
        <div className="form-grid form-grid--3">
          {([['surface', 'Surface condition OK'], ['pickled', 'Degreased and pickled'], ['threads', 'Threads clean']] as const).map(([k, label]) => (
            <label key={k} className="field field--check"><input type="checkbox" checked={pre[k]} onChange={e => setPre(p => ({ ...p, [k]: e.target.checked }))} />{label}</label>
          ))}
        </div>
        {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
      </div>
    </Modal>
  );
}

function PostForm({ batch, onClose }: { batch: GiBatch; onClose: () => void }) {
  return (
    <FormModal title={`Post-GI check, ${batch.no}`} subtitle={`Black weight ${kgs(batch.blackKg, 1)}. Normal zinc pick-up for this family is ${ZINC_BAND.min}–${ZINC_BAND.max}%.`} onClose={onClose} submitLabel="Record result"
      initial={{ giKg: Math.round(batch.blackKg * 1.065), coatingMin: 52, coatingAvg: 64 }}
      fields={[
        { key: 'giKg', label: 'Galvanised weight (kg)', type: 'number', required: true },
        { key: 'coatingMin', label: 'Coating, local minimum (µm)', type: 'number', required: true },
        { key: 'coatingAvg', label: 'Coating, batch average (µm)', type: 'number', required: true },
      ]}
      aside={v => { const p = zincPickup(batch.blackKg, Number(v.giKg) || 0); return <div className={`calc-strip${zincInBand(p) ? '' : ' calc-strip--bad'}`}><span>Zinc pick-up<strong>{p}%</strong></span><span>{zincInBand(p) ? 'Inside the normal band' : 'Outside the normal band: an alert will be raised'}</span></div>; }}
      onSubmit={v => {
        const r = act(d => postGi(d, batch.id, { giKg: Number(v.giKg), coatingMin: Number(v.coatingMin), coatingAvg: Number(v.coatingAvg) }));
        if (typeof r === 'string') return r;
        if (r.failed) { notify(r.notice!, 'warn'); return; }
        notify(r.inBand ? 'Batch passed. Hand it over to packing.' : `Batch passed with zinc pick-up ${r.pickup}%: alert raised`, r.inBand ? 'ok' : 'warn');
      }} />
  );
}
