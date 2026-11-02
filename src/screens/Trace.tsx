import { useEffect, useState } from 'react';
import { Receipt, FileBadge, ClipboardCheck, Flame, Factory, Cylinder, Truck, Package, Search, Users } from 'lucide-react';
import { useDB } from '../data/store';
import { PageHead, Code, Qr } from '../components/shell';
import { Button, KV, notify } from '../components/ui';
import { num, kgs, niceDate } from '../lib/format';
import { stageName, zincPickup } from '../lib/plant';
import { traceBack, traceHeat, identify } from '../lib/trace';
import { item, machine, party } from '../lib/actions';
import { takeFocus } from '../modules';

export function Trace() {
  const db = useDB();
  const [q, setQ] = useState('');
  const [hit, setHit] = useState<{ kind: 'pack' | 'lot' | 'heat'; id: string } | null>(null);
  useEffect(() => {
    const read = () => { const f = takeFocus(); if (f?.includes(':')) { const [kind, ...rest] = f.split(':'); setHit({ kind: kind as 'pack', id: rest.join(':') }); } };
    read();
    window.addEventListener('macanx-focus', read);
    return () => window.removeEventListener('macanx-focus', read);
  }, []);
  const search = (term: string) => { const h = identify(db, term); if (!h) notify(`Nothing found for “${term}”.`, 'warn'); else setHit(h); };
  const sampleDispatched = db.packs.find(p => p.state === 'Dispatched' && p.itemId === 'fg-hb1660');
  return (
    <>
      <PageHead title="Traceability" sub="Any pack traces back to the steel mill in one step. Pick a heat number to see every customer who received material from it." />
      <form className="toolbar" onSubmit={e => { e.preventDefault(); search(q); }}>
        <div className="search" style={{ width: 'min(100%, 420px)' }}><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Pack, lot, heat, challan or invoice no." aria-label="Trace" /></div>
        <Button type="submit">Trace</Button>
        <span className="muted small">Try</span>
        {sampleDispatched && <Button small variant="ghost" onClick={() => setHit({ kind: 'pack', id: sampleDispatched.no })}>{sampleDispatched.no}</Button>}
        <Button small variant="ghost" onClick={() => setHit({ kind: 'heat', id: 'H-24187' })}>Heat H-24187</Button>
      </form>
      {!hit && <div className="empty">Scan a pack QR or type a number to see its full history.</div>}
      {hit?.kind === 'pack' && <PackTrace packNo={hit.id} onHeat={h => setHit({ kind: 'heat', id: h })} />}
      {hit?.kind === 'heat' && <HeatTrace heat={hit.id} onPack={p => setHit({ kind: 'pack', id: p })} />}
      {hit?.kind === 'lot' && <div className="empty">Lot {hit.id} has not been packed yet. Find it under Production or Stage-wise stock.</div>}
    </>
  );
}

function PackTrace({ packNo, onHeat }: { packNo: string; onHeat: (h: string) => void }) {
  const db = useDB();
  const t = traceBack(db, packNo);
  if (!t) return <div className="empty">No pack {packNo}.</div>;
  return (
    <div className="grid-side">
      <ol className="chain">
        {t.invoice && <Step icon={<Receipt size={15} />} title={`Invoice ${t.invoice.no}`} text={`${niceDate(t.invoice.date)}, ${num(t.invoice.pcs)} pcs at SO rate to ${t.customer}`} />}
        {t.dispatch && <Step icon={<Truck size={15} />} title={`Dispatch ${t.dispatch.no}`} text={`${niceDate(t.dispatch.date)}, vehicle ${t.dispatch.vehicle}, LR ${t.dispatch.lr}`} />}
        {t.mdcc && <Step icon={<FileBadge size={15} />} title={`MDCC ${t.mdcc.no}`} text={`${num(t.mdcc.pcs)} pcs cleared on ${niceDate(t.mdcc.date)}, valid till ${niceDate(t.mdcc.validTill)}`} />}
        {t.tpi && <Step icon={<ClipboardCheck size={15} />} title={`TPI ${t.tpi.no}`} text={`${party(db, t.tpi.agencyId).name}, report ${t.tpi.report || 'awaited'}`} />}
        <Step icon={<Package size={15} />} title={`Pack ${t.pack.no}`} text={`${num(t.pack.pcs)} pcs ${t.item.name}, ${num(t.pack.netKg, 2)} kg net, state: ${t.pack.state.toLowerCase()}`} />
        {t.batch && <Step icon={<Flame size={15} />} title={`GI batch ${t.batch.no}`} text={`${machine(db, t.batch.kettleId).code}, ${t.batch.tempC} °C, coating ${t.batch.coatingMin}/${t.batch.coatingAvg} µm, zinc pick-up ${zincPickup(t.batch.blackKg, t.batch.giKg)}%`} />}
        {t.jobCards.map(j => (
          <Step key={j.lot.no} icon={<Factory size={15} />} title={`${stageName(j.lot.stage)} lot ${j.lot.no}`}
            text={`${j.wo.operation} on ${j.machine.code} by ${j.operator}, ${niceDate(j.lot.date)} ${j.lot.shift?.toLowerCase()} shift, job card ${j.wo.no}`} />
        ))}
        {t.chain.filter(l => l.source === 'Bought').map(l => <Step key={l.no} icon={<Factory size={15} />} title={`Bought lot ${l.no}`} text={`Vendor batch ${l.vendorBatch}`} />)}
        {t.heats.map(h => (
          <Step key={h.heatNo} icon={<Cylinder size={15} />} title={`Heat ${h.heatNo}`}
            text={h.grn ? `${h.supplier}, received on ${h.grn.no} (${niceDate(h.grn.date)}); mill TC C ${h.grn.tc.c}%, Mn ${h.grn.tc.mn}%, ${h.grn.tc.tensile} MPa` : 'Opening stock'}
            action={<Button small variant="ghost" onClick={() => onHeat(h.heatNo)}>Where else did this heat go?</Button>} />
        ))}
      </ol>
      <div className="panel">
        <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
          <Qr text={t.pack.no} size={104} />
          <KV items={[['Customer', t.customer], ['SO', <Code>{t.order.no}</Code>], ['Client PO', <Code>{t.order.clientPo}</Code>], ['Item', t.item.name], ['Lots', `${t.chain.length} in the chain`], ['Heats', t.heats.map(h => h.heatNo).join(', ')]]} />
        </div>
      </div>
    </div>
  );
}

function HeatTrace({ heat, onPack }: { heat: string; onPack: (p: string) => void }) {
  const db = useDB();
  const r = traceHeat(db, heat);
  return (
    <div className="grid-2">
      <div className="panel">
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>Heat {heat}</h3>
        <KV items={[
          ['Supplier', r.grn ? party(db, r.grn.vendorId).name : '—'], ['GRN', r.grn ? <Code>{r.grn.no}</Code> : '—'], ['Received', r.grn ? niceDate(r.grn.date) : '—'],
          ['Lots made', String(r.lots.length)], ['Packs', String(r.packs.length)], ['Dispatched packs', String(r.packs.filter(p => p.state === 'Dispatched').length)],
        ]} />
        <h4 style={{ margin: '14px 0 6px', fontFamily: 'var(--f-display)' }}><Users size={15} style={{ verticalAlign: -2 }} /> Customers who received it</h4>
        {r.customers.length ? <ul style={{ paddingLeft: 18 }}>{r.customers.map(c => <li key={c}>{c}</li>)}</ul> : <p className="muted">Nothing from this heat has been dispatched yet.</p>}
      </div>
      <div className="panel">
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>Lots from this heat</h3>
        <table className="table table--compact">
          <thead><tr><th>Lot</th><th>Stage</th><th style={{ textAlign: 'right' }}>pcs</th><th style={{ textAlign: 'right' }}>kg</th></tr></thead>
          <tbody>{r.lots.map(l => <tr key={l.no}><td><Code>{l.no}</Code></td><td>{stageName(l.stage)}</td><td style={{ textAlign: 'right' }}>{num(l.pcs)}</td><td style={{ textAlign: 'right' }}>{num(l.kg)}</td></tr>)}</tbody>
        </table>
        {r.dispatches.length > 0 && <>
          <h4 style={{ margin: '14px 0 6px', fontFamily: 'var(--f-display)' }}>Dispatches</h4>
          {r.dispatches.map(d => <p key={d.id} className="small"><Code>{d.no}</Code> {niceDate(d.date)}, {kgs(d.kg)} <Button small variant="ghost" onClick={() => onPack(d.packs[0])}>Open a pack</Button></p>)}
        </>}
        <p className="muted small" style={{ marginTop: 8 }}>{item(db, r.lots[0]?.itemId ?? 'scrap').name}</p>
      </div>
    </div>
  );
}

function Step({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <li>
      <span className="chain__dot">{icon}</span>
      <div className="chain__body"><h4>{title}</h4><p>{text}</p>{action && <div style={{ marginTop: 4 }}>{action}</div>}</div>
    </li>
  );
}
