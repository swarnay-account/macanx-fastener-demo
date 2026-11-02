import { useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, PackageMinus, ClipboardCheck, Lock } from 'lucide-react';
import { useDB, act } from '../data/store';
import { PageHead, Code, StockBadge, Qr } from '../components/shell';
import { Button, Badge, DataTable, Modal, Tabs, KV, SearchBox, notify, matches, type Tone } from '../components/ui';
import { num, kgs, niceDate } from '../lib/format';
import { kgFromPcs, maxYieldPcs, jobCardBalance, stageName } from '../lib/plant';
import { issueHeat, issueLot, recordOutput, ipqc, closeJobCard, issuedPcs, item, machine, employee, bomFor, routingFor, OP_STAGE, lot } from '../lib/actions';
import { positions } from '../lib/inventory';
import { inPlant } from '../lib/metrics';
import type { WorkOrder, DB } from '../data/types';

const WO_TONE: Record<WorkOrder['status'], Tone> = { Planned: 'grey', Released: 'blue', Running: 'gold', Closed: 'green' };

export function Production() {
  const db = useDB();
  const [tab, setTab] = useState<'cards' | 'lots'>('cards');
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const wos = inPlant(db).workOrders.filter(w => w.status !== 'Planned').sort((a, b) => (a.status === 'Closed' ? 1 : 0) - (b.status === 'Closed' ? 1 : 0) || b.date.localeCompare(a.date));
  const lots = inPlant(db).lots.filter(l => l.source === 'In-house' && l.stage !== 'GALV' && matches(q, l.no, item(db, l.itemId).name, ...l.heats)).reverse();
  return (
    <>
      <PageHead title="Production" sub="Recorded per machine, per shift and per job card, in pieces and kg. Every output becomes a lot linked to its raw material heat." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'cards', label: 'Job cards', count: wos.filter(w => w.status !== 'Closed').length }, { id: 'lots', label: 'Lots', count: lots.length }]} />
      {tab === 'cards' ? (
        <DataTable rows={wos} onRowClick={w => setOpen(w.id)} pageSize={12} columns={[
          { key: 'no', label: 'Job card', render: w => <div className="cell2"><Code>{w.no}</Code><small>{niceDate(w.date)}, {w.shift}</small></div> },
          { key: 'op', label: 'Operation', render: w => w.operation },
          { key: 'it', label: 'Item', render: w => item(db, w.itemId).name },
          { key: 'm', label: 'Machine', render: w => <div className="cell2"><span>{machine(db, w.machineId).code}</span><small>{employee(db, w.operatorId)?.name}</small></div> },
          { key: 't', label: 'Target / done', align: 'right', render: w => `${num(w.targetPcs)} / ${num(w.outputPcs)}` },
          { key: 's', label: 'Scrap', align: 'right', render: w => w.scrapKg ? kgs(w.scrapKg, 1) : '—' },
          { key: 'st', label: 'Status', render: w => <Badge tone={WO_TONE[w.status]}>{w.status}</Badge> },
        ]} actions={w => w.status !== 'Closed' ? <Button small variant="soft" onClick={() => setOpen(w.id)}>Open card</Button> : null} />
      ) : (
        <>
          <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder="Search lot, item or heat" /></div>
          <LotTable lots={lots} />
        </>
      )}
      {open && <JobCard wo={db.workOrders.find(w => w.id === open)!} onClose={() => setOpen(null)} />}
    </>
  );
}

function LotTable({ lots }: { lots: ReturnType<typeof useDB>['lots'] }) {
  const db = useDB();
  return <DataTable rows={lots.map(l => ({ ...l, id: l.no }))} pageSize={12} columns={[
    { key: 'no', label: 'Lot', render: l => <Code>{l.no}</Code> },
    { key: 'st', label: 'Stage', render: l => stageName(l.stage) },
    { key: 'it', label: 'Item', render: l => item(db, l.itemId).name },
    { key: 'p', label: 'pcs / kg', align: 'right', render: l => `${num(l.pcs)} / ${num(l.kg)}` },
    { key: 'h', label: 'Heat', render: l => l.heats.map(h => <Code key={h}>{h} </Code>) },
    { key: 'q', label: 'IPQC', render: l => <Badge tone={l.ipqc === 'Pass' ? 'green' : l.ipqc === 'Fail' ? 'red' : 'grey'}>{l.ipqc}</Badge> },
    { key: 'pos', label: 'Now', render: l => { const p = positions(db, l.no).find(x => x.stage === l.stage); return p ? <StockBadge status={p.status} /> : <span className="muted small">Moved on</span>; } },
  ]} actions={l => l.ipqc !== 'Pass' && positions(db, l.no).some(p => p.stage === l.stage) ? <>
    <Button small variant="ghost" onClick={() => { const r = act(d => ipqc(d, l.no, true)); if (r) notify(r, 'warn'); else notify(`${l.no} passed in-process QC`); }}>Pass</Button>
    {l.ipqc !== 'Fail' && <Button small variant="ghost" onClick={() => { const r = act(d => ipqc(d, l.no, false, 'Failed in-process check')); if (r) notify(r, 'warn'); else notify(`${l.no} put on quality hold`, 'warn'); }}>Fail</Button>}
  </> : null} />;
}

function JobCard({ wo, onClose }: { wo: WorkOrder; onClose: () => void }) {
  const db = useDB();
  const it = item(db, wo.itemId);
  const m = machine(db, wo.machineId);
  const bom = bomFor(db, wo.itemId)!;
  const isHeading = wo.operation === 'Heading';
  const ops = routingFor(db, wo.itemId);
  const prevStage = isHeading ? null : OP_STAGE[ops[ops.indexOf(wo.operation) - 1]];
  const [heat, setHeat] = useState('');
  const [issueKg, setIssueKg] = useState(0);
  const [out, setOut] = useState({ pcs: 0, rejectPcs: 0, scrapKg: 0 });
  const [error, setError] = useState('');
  const inputKg = wo.issued.reduce((s, x) => s + x.kg, 0);
  const max = isHeading ? maxYieldPcs(inputKg, bom.inputKgPer1000) : issuedPcs(db, wo);
  const bal = jobCardBalance(inputKg, wo.outputKg, wo.scrapKg, wo.rejectKg);

  // Heats of the right raw material with stock usable for this order (hold shown, refused on issue).
  const heats = [...new Set(db.ledger.filter(r => r.stage === 'RM' && db.items.find(i => i.id === r.itemId)?.type === 'Raw material').map(r => r.lotOrHeat))]
    .map(h => ({ h, pos: positions(db, h).filter(p => p.stage === 'RM') })).filter(x => x.pos.length);
  const prevLots = prevStage ? db.lots.filter(l => l.itemId === wo.itemId && l.stage === prevStage && l.soId === wo.soId && positions(db, l.no).some(p => p.stage === prevStage)) : [];
  const run = (fn: (d: DB) => string | void | object, ok: string) => { const r = act(d => fn(d)); if (typeof r === 'string') setError(r); else { setError(''); notify(ok); } };

  return (
    <Modal title={`Job card ${wo.no}`} subtitle={`${wo.operation} on ${m.code}, ${niceDate(wo.date)} ${wo.shift.toLowerCase()} shift`} wide onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {wo.status === 'Running' && <Button variant="primary" icon={<Lock size={15} />} onClick={() => run(d => closeJobCard(d, wo.id) ?? undefined, `${wo.no} closed and balanced`)}>Close job card</Button>}
      </>}>
      <div className="stack">
        <div className="jobcard">
          <Qr text={`${wo.no}|${m.code}|${it.code}`} size={110} />
          <KV items={[
            ['Item', it.name], ['Size and class', `M${it.dia}×${it.length}, ${it.propertyClass}`], ['Target', `${num(wo.targetPcs)} pcs (${kgs(kgFromPcs(it, wo.targetPcs))})`],
            ['Machine', `${m.code} ${m.name}`], ['Operator', employee(db, wo.operatorId)?.name ?? '—'], ['Die set', wo.dieSet],
            ['SO', db.orders.find(o => o.id === wo.soId)?.no ?? '—'], ['Status', <Badge tone={WO_TONE[wo.status]}>{wo.status}</Badge>],
          ]} />
        </div>

        {wo.status === 'Released' || wo.status === 'Running' ? (
          <div className="grid-2">
            <div className="panel" style={{ padding: 14 }}>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}><PackageMinus size={16} style={{ verticalAlign: -2 }} /> {isHeading ? 'Issue raw material' : `Issue lots from ${stageName(prevStage!).toLowerCase()}`}</h3>
              {isHeading ? (
                <div className="form-grid">
                  <div className="field field--full"><label htmlFor="jc-heat">Scan coil or heat</label>
                    <select id="jc-heat" value={heat} onChange={e => setHeat(e.target.value)}>
                      <option value="">Choose heat…</option>
                      {heats.map(({ h, pos }) => <option key={h} value={h}>{h} · {item(db, pos[0].itemId).name} · {pos.map(p => `${num(p.kg)} kg ${p.status.toLowerCase()}`).join(', ')}</option>)}
                    </select><small>BOM needs {item(db, bom.rmItemId).name}; grade is checked on issue.</small></div>
                  <div className="field"><label htmlFor="jc-kg">kg</label><input id="jc-kg" type="number" value={issueKg || ''} onChange={e => setIssueKg(Number(e.target.value))} /></div>
                  <div className="field" style={{ justifyContent: 'flex-end' }}><Button onClick={() => run(d => issueHeat(d, wo.id, heat, issueKg), `${num(issueKg)} kg of ${heat} issued`)} disabled={!heat}>Issue</Button></div>
                </div>
              ) : (
                <ul className="check-list">
                  {prevLots.length === 0 && <li className="muted small">No {stageName(prevStage!).toLowerCase()} lots of this item are free for this order.</li>}
                  {prevLots.map(l => (
                    <li key={l.no}><label style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                      <span><Code>{l.no}</Code> {num(l.pcs)} pcs {l.ipqc !== 'Pass' && <Badge tone={l.ipqc === 'Fail' ? 'red' : 'grey'}>IPQC {l.ipqc.toLowerCase()}</Badge>}</span>
                      <Button small variant="ghost" onClick={() => run(d => issueLot(d, wo.id, l.no), `${l.no} issued`)}>Issue</Button>
                    </label></li>
                  ))}
                </ul>
              )}
              {wo.issued.length > 0 && <p className="muted small" style={{ marginTop: 8 }}>Issued: {wo.issued.map(x => `${x.heatNo} (${num(x.kg)} kg)`).join(', ')}</p>}
            </div>
            <div className="panel" style={{ padding: 14 }}>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>Production entry</h3>
              <div className="form-grid form-grid--3">
                <div className="field"><label htmlFor="jc-p">Good pcs</label><input id="jc-p" type="number" value={out.pcs || ''} onChange={e => setOut({ ...out, pcs: Number(e.target.value) })} /></div>
                <div className="field"><label htmlFor="jc-r">Rejected pcs</label><input id="jc-r" type="number" value={out.rejectPcs || ''} onChange={e => setOut({ ...out, rejectPcs: Number(e.target.value) })} /></div>
                <div className="field"><label htmlFor="jc-s">Scrap kg</label><input id="jc-s" type="number" value={out.scrapKg || ''} onChange={e => setOut({ ...out, scrapKg: Number(e.target.value) })} /></div>
              </div>
              <div className="calc-strip" style={{ marginTop: 10 }}>
                <span>Output<strong>{kgs(kgFromPcs(it, out.pcs), 1)}</strong></span>
                <span>Can still book<strong>{num(Math.max(0, max - wo.outputPcs - Math.round(wo.rejectKg * 1000 / it.kgPer1000)))} pcs</strong></span>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <Button variant="signal" icon={<ClipboardCheck size={15} />} onClick={() => {
                  const r = act(d => recordOutput(d, wo.id, out));
                  if (typeof r === 'string') setError(r); else { setError(''); notify(`Lot ${r.no} created`); setOut({ pcs: 0, rejectPcs: 0, scrapKg: 0 }); }
                }}>Book output & create lot</Button>
              </div>
            </div>
          </div>
        ) : wo.status === 'Planned' ? <p className="muted">This card is planned. Release it from the planning board first.</p> : null}

        <div className="calc-strip">
          <span>Input<strong>{kgs(inputKg, 1)}</strong></span><span>Output<strong>{kgs(wo.outputKg, 1)}</strong></span>
          <span>Scrap<strong>{kgs(wo.scrapKg, 1)}</strong></span><span>Rejection<strong>{kgs(wo.rejectKg, 1)}</strong></span>
          <span>Balance<strong className={bal.ok ? 'tone-green' : 'tone-red'}>{bal.ok ? 'balances' : `${kgs(bal.diffKg, 1)} (${bal.diffPct}%) unaccounted`}</strong></span>
        </div>

        {wo.lots.length > 0 && (
          <table className="table table--compact">
            <thead><tr><th>Lot</th><th style={{ textAlign: 'right' }}>pcs</th><th style={{ textAlign: 'right' }}>kg</th><th>Heats</th><th>IPQC</th><th /></tr></thead>
            <tbody>{wo.lots.map(n => { const l = lot(db, n)!; const here = positions(db, n).some(p => p.stage === l.stage); return (
              <tr key={n}><td><Code>{n}</Code></td><td style={{ textAlign: 'right' }}>{num(l.pcs)}</td><td style={{ textAlign: 'right' }}>{num(l.kg, 1)}</td><td>{l.heats.join(', ')}</td>
                <td><Badge tone={l.ipqc === 'Pass' ? 'green' : l.ipqc === 'Fail' ? 'red' : 'grey'}>{l.ipqc}</Badge></td>
                <td className="row-actions">{here && l.ipqc !== 'Pass' && <>
                  <button className="icon-btn" title="IPQC pass" onClick={() => run(d => ipqc(d, n, true), `${n} passed`)}><CheckCircle2 size={16} /></button>
                  {l.ipqc !== 'Fail' && <button className="icon-btn" title="IPQC fail: hold lot" onClick={() => run(d => ipqc(d, n, false, 'Failed in-process check'), `${n} put on hold`)}><XCircle size={16} /></button>}
                </>}</td></tr>
            ); })}</tbody>
          </table>
        )}
        {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
      </div>
    </Modal>
  );
}
