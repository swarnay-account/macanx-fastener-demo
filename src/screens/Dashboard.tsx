import { useMemo } from 'react';
import { Factory, Truck, FileCheck2, Clock3, Flame, Recycle } from 'lucide-react';
import { useDB } from '../data/store';
import { PageHead, StageRail } from '../components/shell';
import { Panel, Stat } from '../components/ui';
import { HBars } from '../components/charts';
import { go, setFocus } from '../modules';
import { num, inrShort, shortDate, mt } from '../lib/format';
import { ZINC_BAND, zincPickup } from '../lib/plant';
import { today } from '../lib/inventory';
import { planVsActual, scrapByMachine, giByKettle, dispatchMtd, pendingMdcc, overduePos, downtimeByReason, pmStatus, inPlant } from '../lib/metrics';
import { item, machine } from '../lib/actions';

export function Dashboard() {
  const db = useDB();
  const m = useMemo(() => {
    const pva = planVsActual(db, 14);
    const week = pva.reduce((s, d) => ({ plan: s.plan + d.plan, act: s.act + d.act }), { plan: 0, act: 0 });
    return {
      pva, week, scrap: scrapByMachine(db), gi: giByKettle(db, 14), dmtd: dispatchMtd(db), mdcc: pendingMdcc(db), overdue: overduePos(db),
      down: downtimeByReason(db).slice(0, 5), pm: pmStatus(db), plant: inPlant(db),
    };
  }, [db]);
  const giWeek = m.gi.reduce((s, k) => s + k.kg, 0);
  const batches = m.plant.batches.filter(b => b.post === 'Pass');
  const avgPick = batches.length ? batches.reduce((s, b) => s + zincPickup(b.blackKg, b.giKg), 0) / batches.length : 0;
  const outBand = batches.filter(b => { const p = zincPickup(b.blackKg, b.giKg); return p < ZINC_BAND.min || p > ZINC_BAND.max; });
  const totalScrap = m.scrap.reduce((s, x) => ({ input: s.input + x.input, scrap: s.scrap + x.scrap }), { input: 0, scrap: 0 });
  const maxPva = Math.max(1, ...m.pva.flatMap(d => [d.plan, d.act]));

  const attention: { tone: 'red' | 'gold' | 'blue'; text: string; to: Parameters<typeof go>[0]; focus?: string }[] = [];
  m.plant.machines.filter(x => x.status === 'Breakdown').forEach(x => attention.push({ tone: 'red', text: `${x.code} is down: open breakdown ticket`, to: 'maintenance' }));
  db.grns.filter(g => g.qc === 'Quality hold').forEach(g => attention.push({ tone: 'gold', text: `${g.no} waiting for incoming QC`, to: 'inward' }));
  db.lots.filter(l => l.status === 'Quality hold' && l.ipqc === 'Fail').forEach(l => attention.push({ tone: 'gold', text: `Lot ${l.no} on hold after in-process QC`, to: 'production' }));
  m.pm.filter(p => p.state !== 'Planned').forEach(p => attention.push({ tone: p.state === 'Overdue' ? 'red' : 'blue', text: `PM ${p.state.toLowerCase()} on ${machine(db, p.pm.machineId).code}: ${p.pm.task}`, to: 'maintenance' }));
  outBand.forEach(b => attention.push({ tone: 'gold', text: `${b.no}: zinc pick-up ${zincPickup(b.blackKg, b.giKg)}% outside ${ZINC_BAND.min}–${ZINC_BAND.max}%`, to: 'galvanising' }));
  const pending = db.approvals.filter(a => a.state === 'Pending');
  if (pending.length) attention.push({ tone: 'blue', text: `${pending.length} approvals waiting`, to: 'approvals' });

  return (
    <>
      <PageHead title="Plant today" sub={`${db.plant === 'AHD' ? 'Ahmedabad' : 'Mundra SEZ'} plant, ${new Date(today()).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}. Built only from ERP transactions; every figure opens the report behind it.`} />

      <StageRail onPick={s => { setFocus(`stage:${s}`); go('stock'); }} />

      <div className="stats">
        <button className="stat-link" onClick={() => go('reports', 'r19')}>
          <Stat icon={<Factory size={16} />} label="Production vs plan, 14 days" value={`${m.week.plan ? Math.round(m.week.act / m.week.plan * 100) : 0}%`} sub={`${num(m.week.act)} of ${num(m.week.plan)} pcs headed`} />
        </button>
        <button className="stat-link" onClick={() => go('reports', 'r33')}>
          <Stat icon={<Truck size={16} />} label="Dispatch, last 30 days" value={mt(m.dmtd.kg)} sub={`Target ${num(m.dmtd.targetKg / 1000)} MT, invoiced ${inrShort(m.dmtd.value)}`} tone={m.dmtd.kg < m.dmtd.targetKg / 2 ? 'gold' : 'green'} />
        </button>
        <button className="stat-link" onClick={() => go('reports', 'r32')}>
          <Stat icon={<FileCheck2 size={16} />} label="Pending MDCC" value={`${num(m.mdcc.reduce((s, r) => s + r.pcs, 0))} pcs`} sub={`${new Set(m.mdcc.map(r => r.so.id)).size} sales orders waiting`} tone="gold" />
        </button>
        <button className="stat-link" onClick={() => go('reports', 'r9')}>
          <Stat icon={<Clock3 size={16} />} label="Overdue POs" value={String(m.overdue.length)} sub={m.overdue.length ? `${inrShort(m.overdue.reduce((s, p) => s + p.value, 0))} with vendors past due` : 'All vendors on time'} tone={m.overdue.length ? 'red' : 'green'} />
        </button>
        <button className="stat-link" onClick={() => go('reports', 'r24')}>
          <Stat icon={<Recycle size={16} />} label="Scrap" value={`${totalScrap.input ? (totalScrap.scrap / totalScrap.input * 100).toFixed(1) : '0.0'}%`} sub={`${num(totalScrap.scrap)} kg on headers and rollers`} />
        </button>
        <button className="stat-link" onClick={() => go('reports', 'r27')}>
          <Stat icon={<Flame size={16} />} label="Zinc pick-up" value={`${avgPick.toFixed(1)}%`} sub={`Normal band ${ZINC_BAND.min}–${ZINC_BAND.max}%, ${outBand.length} batch outside`} tone={outBand.length ? 'gold' : 'green'} />
        </button>
        <button className="stat-link" onClick={() => go('reports', 'r25')}>
          <Stat icon={<Flame size={16} />} label="Galvanised, 14 days" value={`${num(giWeek)} kg`} sub={m.gi.map(k => `${k.kettle.code} ${num(k.perDay)} kg/day`).join(', ')} />
        </button>
        <button className="stat-link" onClick={() => go('stock')}>
          <Stat icon={<Factory size={16} />} label="Open work orders" value={String(m.plant.workOrders.filter(w => w.status !== 'Closed').length)} sub={`${m.plant.workOrders.filter(w => w.status === 'Running').length} running on the floor now`} />
        </button>
      </div>

      <div className="grid-3">
        <Panel title="Plan vs actual, last 14 days" className="span-2" action={<span className="legend-inline"><span><i style={{ background: 'var(--rule)' }} />Planned</span><span><i style={{ background: 'var(--temper)' }} />Headed</span></span>}>
          <div className="pair-bars" role="img" aria-label="Planned and actual pieces headed per day">
            {m.pva.map(d => (
              <div key={d.date}>
                <div className="bars">
                  <i className="plan" style={{ height: `${d.plan / maxPva * 100}%` }} title={`Planned ${num(d.plan)}`} />
                  <i className="act" style={{ height: `${d.act / maxPva * 100}%` }} title={`Headed ${num(d.act)}`} />
                </div>
                <small>{shortDate(d.date)}</small>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Top downtime reasons, 30 days">
          <HBars data={m.down.map(d => ({ label: d.reason, value: d.minutes }))} format={v => `${num(v)} min`} />
        </Panel>
      </div>

      <div className="grid-3">
        <Panel title="Needs attention">
          {attention.length === 0 ? <p className="muted">Nothing is waiting.</p> : (
            <ul className="attention">
              {attention.slice(0, 8).map((a, i) => <li key={i}><button onClick={() => go(a.to)}><i className={`t-${a.tone}`} /><span>{a.text}</span></button></li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Scrap by machine">
          <HBars data={m.scrap.filter(s => s.input > 0).map(s => ({ label: `${s.machine.code} ${s.machine.name}`, value: Math.round(s.pct * 10) / 10 }))} format={v => `${v}%`} />
        </Panel>
        <Panel title="On the floor">
          <ul className="feed">
            {db.activity.slice(0, 8).map(a => (
              <li key={a.id}><time>{new Date(a.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</time><span>{a.text}</span></li>
            ))}
          </ul>
        </Panel>
      </div>
      <p className="muted small">Running now: {m.plant.workOrders.filter(w => w.status === 'Running').map(w => `${machine(db, w.machineId).code} ${item(db, w.itemId).name.split(',')[0]}`).join(', ') || 'nothing'}</p>
    </>
  );
}
