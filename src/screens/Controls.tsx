import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useDB, act } from '../data/store';
import { PageHead } from '../components/shell';
import { Button, Badge, DataTable, FormModal, Tabs, notify } from '../components/ui';
import { HBars } from '../components/charts';
import { num, niceDate, kgs } from '../lib/format';
import { addDowntime, machine, employee, item } from '../lib/actions';
import { oeeByMachine, downtimeByReason, inPlant } from '../lib/metrics';
import type { DowntimeReason } from '../data/types';

const REASONS: DowntimeReason[] = ['Breakdown', 'Die change', 'No material', 'No power', 'No operator', 'QC hold', 'PM', 'No plan'];
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function Controls() {
  const db = useDB();
  const [tab, setTab] = useState<'oee' | 'downtime' | 'roster' | 'people'>('oee');
  const [adding, setAdding] = useState(false);
  const machines = inPlant(db).machines;
  return (
    <>
      <PageHead title="Plant controls" sub="Downtime with a reason for every stoppage, a named operator, in-charge and supervisor on every machine and shift, and OEE from both."
        actions={<Button variant="signal" icon={<Plus size={16} />} onClick={() => setAdding(true)}>Log downtime</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'oee', label: 'OEE by machine' }, { id: 'downtime', label: 'Downtime' }, { id: 'roster', label: 'Today’s roster' }, { id: 'people', label: 'Output by person' }]} />
      {tab === 'oee' && <DataTable rows={oeeByMachine(db).map(r => ({ ...r, id: r.machine.id }))} columns={[
        { key: 'm', label: 'Machine', render: r => <div className="cell2"><strong>{r.machine.code}</strong><small>{r.machine.name}</small></div> },
        { key: 's', label: 'Shifts run', align: 'right', render: r => r.shifts },
        { key: 'd', label: 'Downtime', align: 'right', render: r => `${num(r.downMin)} min` },
        { key: 'a', label: 'Availability', align: 'right', render: r => r.shifts ? pct(r.availability) : '—' },
        { key: 'p', label: 'Performance', align: 'right', render: r => r.shifts ? pct(r.performance) : '—' },
        { key: 'q', label: 'Quality', align: 'right', render: r => r.shifts ? pct(r.quality) : '—' },
        { key: 'o', label: 'OEE', align: 'right', render: r => r.shifts ? <strong className={r.oee < 0.6 ? 'tone-red' : r.oee < 0.75 ? 'tone-gold' : 'tone-green'}>{pct(r.oee)}</strong> : <span className="muted">No runs</span> },
      ]} />}
      {tab === 'downtime' && (
        <div className="grid-side">
          <DataTable rows={db.downtime.filter(d => machines.some(m => m.id === d.machineId))} pageSize={12} columns={[
            { key: 'd', label: 'Date', render: d => `${niceDate(d.date)}, ${d.shift}` },
            { key: 'm', label: 'Machine', render: d => machine(db, d.machineId).code },
            { key: 'r', label: 'Reason', render: d => <Badge tone={d.reason === 'Breakdown' ? 'red' : d.reason === 'PM' ? 'grey' : 'gold'}>{d.reason}</Badge> },
            { key: 'n', label: 'Note', render: d => <span className="muted small">{d.note}</span> },
            { key: 'min', label: 'Minutes', align: 'right', render: d => num(d.minutes) },
          ]} />
          <div className="panel"><h3 style={{ fontSize: 17, marginBottom: 10 }}>By reason, 30 days</h3><HBars data={downtimeByReason(db).map(d => ({ label: d.reason, value: d.minutes }))} format={v => `${num(v)} min`} /></div>
        </div>
      )}
      {tab === 'roster' && <DataTable rows={db.roster.filter(r => machines.some(m => m.id === r.machineId)).map(r => ({ ...r, id: r.machineId + r.shift }))} columns={[
        { key: 'm', label: 'Machine', render: r => machine(db, r.machineId).code },
        { key: 's', label: 'Shift', render: r => r.shift },
        { key: 'o', label: 'Operator', render: r => employee(db, r.operatorId)?.name },
        { key: 'i', label: 'In-charge', render: r => employee(db, r.inchargeId)?.name },
        { key: 'v', label: 'Supervisor', render: r => employee(db, r.supervisorId)?.name },
      ]} />}
      {tab === 'people' && <DataTable rows={db.employees.filter(e => e.role === 'Operator').map(e => {
        const ws = db.workOrders.filter(w => w.operatorId === e.id && w.outputPcs > 0);
        return { id: e.id, e, cards: ws.length, pcs: ws.reduce((s, w) => s + w.outputPcs, 0), kg: ws.reduce((s, w) => s + w.outputKg, 0), scrap: ws.reduce((s, w) => s + w.scrapKg, 0), rej: ws.reduce((s, w) => s + w.rejectKg, 0), items: [...new Set(ws.map(w => item(db, w.itemId).name.split(',')[0]))] };
      })} columns={[
        { key: 'n', label: 'Operator', render: r => <div className="cell2"><span>{r.e.name}</span><small>{r.e.skills.join(', ')}</small></div> },
        { key: 'c', label: 'Job cards', align: 'right', render: r => r.cards },
        { key: 'p', label: 'Output', align: 'right', render: r => `${num(r.pcs)} pcs` },
        { key: 'k', label: 'Output kg', align: 'right', render: r => kgs(r.kg) },
        { key: 's', label: 'Scrap', align: 'right', render: r => kgs(r.scrap, 1) },
        { key: 'r', label: 'Rejection', align: 'right', render: r => kgs(r.rej, 1) },
      ]} />}
      {adding && (
        <FormModal title="Log downtime" onClose={() => setAdding(false)} submitLabel="Save" initial={{ machineId: machines[1]?.id, reason: 'Die change', minutes: 30, shift: 'Day', note: '' }}
          fields={[
            { key: 'machineId', label: 'Machine', type: 'select', required: true, options: machines.map(m => ({ value: m.id, label: `${m.code} ${m.name}` })) },
            { key: 'reason', label: 'Reason', type: 'select', required: true, options: REASONS.map(r => ({ value: r, label: r })) },
            { key: 'minutes', label: 'Minutes stopped', type: 'number', required: true },
            { key: 'shift', label: 'Shift', type: 'select', options: [{ value: 'Day', label: 'Day' }, { value: 'Night', label: 'Night' }] },
            { key: 'note', label: 'Note', full: true },
          ]}
          onSubmit={v => { const r = act(d => addDowntime(d, { machineId: v.machineId, minutes: Number(v.minutes), reason: v.reason, note: v.note, shift: v.shift })); if (r) return r; notify('Downtime logged'); }} />
      )}
    </>
  );
}
