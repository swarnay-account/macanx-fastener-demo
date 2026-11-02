import { useState, Fragment } from 'react';
import { Play, Wand2 } from 'lucide-react';
import { useDB, act } from '../data/store';
import { PageHead, Code } from '../components/shell';
import { Button, Badge, DataTable, Modal, FormModal, Tabs, KV, notify } from '../components/ui';
import { num, kgs, niceDate, addDays, shortDate } from '../lib/format';
import { stockOf } from '../lib/plant';
import { planningRun, planLine, releaseWo, moveWo, shiftLoad, woHours, pmHours, item, machine, employee, bomFor } from '../lib/actions';
import { inPlant } from '../lib/metrics';
import { today } from '../lib/inventory';
import type { WorkOrder, Shift } from '../data/types';

export function Planning() {
  const db = useDB();
  const [tab, setTab] = useState<'board' | 'net' | 'rm'>('board');
  const run = planningRun(db);
  return (
    <>
      <PageHead title="Planning" sub="What to make and buy, then which machine runs it in which shift. Sequenced by delivery date, then the same diameter together to save die changes." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'board', label: 'Machine-wise board' },
        { id: 'net', label: 'Net requirement', count: run.filter(r => r.net > 0).length },
        { id: 'rm', label: 'RM needed vs stock' },
      ]} />
      {tab === 'board' && <Board />}
      {tab === 'net' && <NetRequirement />}
      {tab === 'rm' && <RmShortage />}
    </>
  );
}

function NetRequirement() {
  const db = useDB();
  const rows = planningRun(db).map(r => ({ ...r, id: r.lineId }));
  const [plan, setPlan] = useState<(typeof rows)[number] | null>(null);
  return (
    <>
      <p className="muted">Open SO lines by delivery date, less what is already planned. Only the in-house portion is planned on machines; the bought portion becomes a planned purchase.</p>
      <DataTable rows={rows} columns={[
        { key: 'so', label: 'SO', render: r => <Code>{db.orders.find(o => o.id === r.soId)!.no}</Code> },
        { key: 'item', label: 'Item', render: r => item(db, r.itemId).name },
        { key: 'due', label: 'Due', value: r => r.due, render: r => niceDate(r.due) },
        { key: 'in', label: 'In-house', align: 'right', render: r => num(r.inhouse) },
        { key: 'pl', label: 'Planned', align: 'right', render: r => num(r.planned) },
        { key: 'net', label: 'Net to plan', align: 'right', render: r => <strong>{num(r.net)}</strong> },
        { key: 'rm', label: 'RM need vs available', render: r => r.net <= 0 ? <span className="muted">—</span> : <span className={r.rmFree < r.rmKg ? 'tone-red' : ''}>{kgs(r.rmKg)} / {kgs(r.rmFree)}</span> },
        { key: 'buy', label: 'Bought', align: 'right', render: r => r.boughtPcs ? num(r.boughtPcs) : '—' },
      ]} actions={r => r.net > 0 ? <Button small variant="soft" icon={<Wand2 size={14} />} onClick={() => setPlan(r)}>Plan</Button> : <Badge tone="green">Planned</Badge>} />
      {plan && (
        <FormModal title="Create planned work orders" subtitle={`${item(db, plan.itemId).name}: one work order per operation, on the least-loaded machine that runs this size.`}
          onClose={() => setPlan(null)} submitLabel="Create work orders" initial={{ pcs: plan.net, date: addDays(today(), 1), shift: 'Day' }}
          fields={[
            { key: 'pcs', label: 'Pieces', type: 'number', required: true },
            { key: 'date', label: 'Heading date', type: 'date', required: true },
            { key: 'shift', label: 'Shift', type: 'select', options: [{ value: 'Day', label: 'Day' }, { value: 'Night', label: 'Night' }] },
          ]}
          onSubmit={v => {
            if (Number(v.pcs) > plan.net) return `Only ${num(plan.net)} pcs are left to plan on this line.`;
            const r = act(d => planLine(d, plan.soId, plan.lineId, Number(v.pcs), v.date, v.shift));
            if (r) return r;
            notify('Planned work orders created. Release them from the board.');
          }} />
      )}
    </>
  );
}

function RmShortage() {
  const db = useDB();
  const open = inPlant(db).workOrders.filter(w => w.operation === 'Heading' && (w.status === 'Planned' || w.status === 'Released'));
  const map = new Map<string, number>();
  for (const w of open) { const b = bomFor(db, w.itemId)!; map.set(b.rmItemId, (map.get(b.rmItemId) ?? 0) + w.targetPcs * b.inputKgPer1000 / 1000); }
  const rows = [...map.entries()].map(([id, need]) => {
    const free = stockOf(db.ledger, { itemId: id, stage: 'RM', status: 'Free', plant: db.plant }).kg + stockOf(db.ledger, { itemId: id, stage: 'RM', status: 'Reserved', plant: db.plant }).kg;
    const hold = stockOf(db.ledger, { itemId: id, stage: 'RM', status: 'Quality hold', plant: db.plant }).kg;
    const onOrder = db.pos.filter(p => p.status === 'Open' && p.lines[0].itemId === id).reduce((s, p) => s + p.lines[0].qtyKg - p.lines[0].receivedKg, 0);
    return { id, need, free, hold, onOrder, short: Math.max(0, need - free) };
  });
  return <DataTable rows={rows} empty="No planned work orders need raw material." columns={[
    { key: 'i', label: 'Raw material', render: r => item(db, r.id).name },
    { key: 'n', label: 'Needed by open WOs', align: 'right', render: r => kgs(r.need) },
    { key: 'f', label: 'In stock', align: 'right', render: r => kgs(r.free) },
    { key: 'h', label: 'On quality hold', align: 'right', render: r => r.hold ? kgs(r.hold) : '—' },
    { key: 'o', label: 'On order', align: 'right', render: r => r.onOrder ? kgs(r.onOrder) : '—' },
    { key: 's', label: 'Short', align: 'right', render: r => r.short ? <strong className="tone-red">{kgs(r.short)}</strong> : <Badge tone="green">Covered</Badge> },
  ]} />;
}

function Board() {
  const db = useDB();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [open, setOpen] = useState<WorkOrder | null>(null);
  const [overload, setOverload] = useState<{ wo: WorkOrder; machineId: string; date: string; shift: Shift; msg: string } | null>(null);
  const machines = inPlant(db).machines.filter(m => ['Header', 'Thread roller', 'HT furnace', 'Wire drawing'].includes(m.type));
  const days = Array.from({ length: 4 }, (_, i) => addDays(today(), i - 1));
  const cols = days.flatMap(d => (['Day', 'Night'] as Shift[]).map(s => ({ date: d, shift: s })));

  const drop = (machineId: string, date: string, shift: Shift) => {
    const w = db.workOrders.find(x => x.id === drag);
    setDrag(null); setOver(null);
    if (!w || (w.machineId === machineId && w.date === date && w.shift === shift)) return;
    const r = act(d => moveWo(d, w.id, machineId, date, shift));
    if (r && /Give a reason/.test(r)) setOverload({ wo: w, machineId, date, shift, msg: r });
    else if (r) notify(r, 'warn');
    else notify(`${w.no} moved to ${machine(db, machineId).code}, ${shift.toLowerCase()} shift`);
  };

  return (
    <>
      <p className="muted small">Drag a job to another machine or shift. The board checks size range and available hours; preventive maintenance and breakdowns take hours out automatically.</p>
      <div className="board-wrap">
        <div className="board" style={{ gridTemplateColumns: `170px repeat(${cols.length}, minmax(112px, 1fr))` }}>
          <div className="board__head">Machine</div>
          {cols.map(c => <div className="board__head" key={c.date + c.shift}>{c.shift}<small>{c.date === today() ? 'Today' : shortDate(c.date)}</small></div>)}
          {machines.map(m => (
            <Fragment key={m.id}>
              <div className="board__machine"><strong>{m.code}</strong><small>{m.type === 'HT furnace' ? m.name : `M${m.diaMin}–M${m.diaMax}`}</small>{m.status === 'Breakdown' && <span className="down-tag">Breakdown</span>}</div>
              {cols.map(c => {
                const key = `${m.id}|${c.date}|${c.shift}`;
                const jobs = db.workOrders.filter(w => w.machineId === m.id && w.date === c.date && w.shift === c.shift);
                const load = shiftLoad(db, m.id, c.date, c.shift);
                const isOver = load.used > load.available;
                const pm = c.shift === 'Day' ? pmHours(db, m.id, c.date) : 0;
                const down = m.status === 'Breakdown' && c.date === today();
                return (
                  <div key={key} className={`board__cell${isOver ? ' is-over' : ''}${over === key ? ' is-drop' : ''}${pm ? ' is-pm' : ''}${down ? ' is-down' : ''}`}
                    onDragOver={e => { e.preventDefault(); setOver(key); }} onDragLeave={() => setOver(o => o === key ? null : o)}
                    onDrop={() => drop(m.id, c.date, c.shift)}>
                    {(jobs.length > 0 || pm > 0) && (
                      <div className={`load${isOver ? ' is-over' : ''}`} title={`${load.used} h of ${load.available} h available`}>
                        <i><b style={{ width: `${Math.min(100, load.available ? load.used / load.available * 100 : 100)}%` }} /></i>{load.used}/{load.available} h
                      </div>
                    )}
                    {pm > 0 && <span className="pm-tag">PM {pm} h</span>}
                    {down && <span className="down-tag">Down</span>}
                    {jobs.map(w => (
                      <button key={w.id} className={`chip-wo st-${w.status}`} draggable={w.status === 'Planned' || w.status === 'Released'}
                        onDragStart={() => setDrag(w.id)} onDragEnd={() => { setDrag(null); setOver(null); }} onClick={() => setOpen(w)}
                        title={`${w.no}, ${w.status.toLowerCase()}`}>
                        <strong>M{item(db, w.itemId).dia}×{item(db, w.itemId).length} {item(db, w.itemId).propertyClass}</strong>
                        <small>{num(w.targetPcs)} pcs, {woHours(db, w)} h</small>
                      </button>
                    ))}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="legend-inline">
        <span><i style={{ background: 'var(--surface)', border: '1px dashed var(--ink-3)' }} />Planned</span>
        <span><i style={{ background: 'var(--graphite)', borderLeft: '3px solid var(--temper)' }} />Released</span>
        <span><i style={{ background: 'var(--graphite)', borderLeft: '3px solid var(--signal)' }} />Running</span>
        <span><i style={{ background: '#e9ecec' }} />PM blocked</span>
        <span><i style={{ background: '#fff8e5', border: '1px solid var(--signal-deep)' }} />Over capacity</span>
      </div>
      {open && <WoModal wo={db.workOrders.find(w => w.id === open.id)!} onClose={() => setOpen(null)} />}
      {overload && (
        <FormModal title="Machine over capacity" subtitle={overload.msg} onClose={() => setOverload(null)} submitLabel="Request override"
          initial={{ reason: '' }} fields={[{ key: 'reason', label: 'Reason for the override', type: 'textarea', required: true }]}
          onSubmit={v => {
            const r = act(d => moveWo(d, overload.wo.id, overload.machineId, overload.date, overload.shift, v.reason));
            if (r) return r;
            notify('Override sent to the plant head for approval', 'info');
          }} />
      )}
    </>
  );
}

function WoModal({ wo, onClose }: { wo: WorkOrder; onClose: () => void }) {
  const db = useDB();
  const it = item(db, wo.itemId);
  return (
    <Modal title={wo.no} subtitle={`${wo.operation}, ${it.name}`} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {wo.status === 'Planned' && <Button variant="signal" icon={<Play size={15} />} onClick={() => {
          const r = act(d => releaseWo(d, wo.id));
          if (typeof r === 'string') notify(r, 'warn');
          else if (r) { notify(r.notice, 'warn'); onClose(); }
          else { notify(`${wo.no} released; the job card is on ${machine(db, wo.machineId).code}`); onClose(); }
        }}>Release to shop floor</Button>}
      </>}>
      <KV items={[
        ['SO', <Code>{db.orders.find(o => o.id === wo.soId)?.no}</Code>], ['Machine', `${machine(db, wo.machineId).code} ${machine(db, wo.machineId).name}`],
        ['Date and shift', `${niceDate(wo.date)}, ${wo.shift}`], ['Target', `${num(wo.targetPcs)} pcs`], ['Load', `${woHours(db, wo)} h incl. setup`],
        ['Operator', employee(db, wo.operatorId)?.name ?? '—'], ['Die set', wo.dieSet], ['Status', wo.status],
      ]} />
    </Modal>
  );
}
