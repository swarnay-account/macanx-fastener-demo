import { useState } from 'react';
import { Siren, Wrench, CheckCircle2 } from 'lucide-react';
import { useDB, act } from '../data/store';
import { PageHead, Code } from '../components/shell';
import { Button, Badge, DataTable, FormModal, Tabs, Stat, notify, type Tone } from '../components/ui';
import { num, niceDate, inr } from '../lib/format';
import { raiseBreakdown, restoreMachine, completePm, machine } from '../lib/actions';
import { pmStatus, inPlant } from '../lib/metrics';
import type { Machine } from '../data/types';

const M_TONE: Record<Machine['status'], Tone> = { Running: 'green', Idle: 'grey', Breakdown: 'red', PM: 'gold' };

export function Maintenance() {
  const db = useDB();
  const [tab, setTab] = useState<'machines' | 'breakdowns' | 'pm'>('machines');
  const [raise, setRaise] = useState(false);
  const [restore, setRestore] = useState<string | null>(null);
  const machines = inPlant(db).machines;
  const bds = db.breakdowns.filter(b => machines.some(m => m.id === b.machineId));
  const done = bds.filter(b => b.status === 'Restored');
  const mttr = done.length ? done.reduce((s, b) => s + (new Date(b.restoredAt!).getTime() - new Date(b.stoppedAt).getTime()) / 60000, 0) / done.length : 0;
  const pm = pmStatus(db);
  const compliance = pm.length ? Math.round(pm.filter(p => p.state !== 'Overdue').length / pm.length * 100) : 100;
  const operators = db.employees.filter(e => e.role === 'Operator' || e.role === 'Prod. in-charge');
  return (
    <>
      <PageHead title="Maintenance" sub="Breakdowns fixed fast, PM never missed. Planned maintenance blocks hours on the planning board automatically."
        actions={<Button variant="signal" icon={<Siren size={16} />} onClick={() => setRaise(true)}>Raise breakdown</Button>} />
      <div className="stats">
        <Stat icon={null} label="Machines down now" value={String(machines.filter(m => m.status === 'Breakdown').length)} sub={machines.filter(m => m.status === 'Breakdown').map(m => m.code).join(', ') || 'All running or idle'} tone={machines.some(m => m.status === 'Breakdown') ? 'red' : 'green'} />
        <Stat icon={null} label="Mean time to repair" value={`${Math.round(mttr)} min`} sub={`${done.length} breakdowns closed`} />
        <Stat icon={null} label="Mean time between failures" value={bds.length > 1 ? `${Math.round(30 * 24 / bds.length)} h` : '—'} sub="Last 30 days, all machines" />
        <Stat icon={null} label="PM compliance" value={`${compliance}%`} sub={`${pm.filter(p => p.state === 'Overdue').length} overdue, ${pm.filter(p => p.state === 'Due').length} due this week`} tone={compliance < 100 ? 'gold' : 'green'} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'machines', label: 'Machine history card' }, { id: 'breakdowns', label: 'Breakdown log', count: bds.length }, { id: 'pm', label: 'PM schedule', count: pm.length }]} />
      {tab === 'machines' && <DataTable rows={machines} columns={[
        { key: 'c', label: 'Machine', render: m => <div className="cell2"><strong>{m.code}</strong><small>{m.name}</small></div> },
        { key: 's', label: 'Status', render: m => <Badge tone={M_TONE[m.status]}>{m.status}</Badge> },
        { key: 'b', label: 'Breakdowns', align: 'right', render: m => db.breakdowns.filter(b => b.machineId === m.id).length },
        { key: 'd', label: 'Downtime, 30 days', align: 'right', render: m => `${num(db.downtime.filter(d => d.machineId === m.id).reduce((s, d) => s + d.minutes, 0))} min` },
        { key: 'p', label: 'Last PM', render: m => { const p = db.pm.find(x => x.machineId === m.id); return p ? niceDate(p.lastDone) : '—'; } },
        { key: 'sp', label: 'Spares cost', align: 'right', render: m => inr(db.breakdowns.filter(b => b.machineId === m.id).flatMap(b => b.spares).reduce((s, x) => s + x.cost * x.qty, 0)) },
      ]} />}
      {tab === 'breakdowns' && <DataTable rows={bds} empty="No breakdowns recorded." columns={[
        { key: 'no', label: 'Ticket', render: b => <Code>{b.no}</Code> },
        { key: 'm', label: 'Machine', render: b => machine(db, b.machineId).code },
        { key: 'p', label: 'Problem', render: b => b.problem },
        { key: 's', label: 'Stopped', render: b => new Date(b.stoppedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) },
        { key: 'r', label: 'Down for', align: 'right', render: b => b.restoredAt ? `${Math.round((new Date(b.restoredAt).getTime() - new Date(b.stoppedAt).getTime()) / 60000)} min` : <Badge tone="red">Still down</Badge> },
        { key: 'w', label: 'Work done', render: b => <span className="muted small">{b.work ?? '—'}{b.spares.length ? `; ${b.spares.map(s => `${s.qty} × ${s.name}`).join(', ')}` : ''}</span> },
      ]} actions={b => b.status === 'Open' ? <Button small variant="soft" icon={<Wrench size={14} />} onClick={() => setRestore(b.id)}>Restore</Button> : null} />}
      {tab === 'pm' && <DataTable rows={pm.map(p => ({ ...p, id: p.pm.id }))} columns={[
        { key: 'm', label: 'Machine', render: p => machine(db, p.pm.machineId).code },
        { key: 't', label: 'Task', render: p => p.pm.task },
        { key: 'e', label: 'Every', render: p => `${p.pm.everyDays} days` },
        { key: 'l', label: 'Last done', render: p => niceDate(p.pm.lastDone) },
        { key: 'd', label: 'Due', render: p => niceDate(p.due) },
        { key: 'h', label: 'Blocks', align: 'right', render: p => `${p.pm.hours} h` },
        { key: 's', label: 'State', render: p => <Badge tone={p.state === 'Overdue' ? 'red' : p.state === 'Due' ? 'gold' : 'grey'}>{p.state}</Badge> },
      ]} actions={p => p.state !== 'Planned' ? <Button small variant="ghost" icon={<CheckCircle2 size={14} />} onClick={() => { act(d => completePm(d, p.pm.id)); notify('PM recorded; checklist, time and next due date updated'); }}>Mark done</Button> : null} />}
      {raise && (
        <FormModal title="Raise breakdown ticket" subtitle="Usually raised by the operator from the tablet. Jobs on the machine are flagged on the planning board." onClose={() => setRaise(false)} submitLabel="Raise ticket"
          initial={{ machineId: machines.find(m => m.status !== 'Breakdown')?.id, problem: '', by: operators[0]?.id }}
          fields={[
            { key: 'machineId', label: 'Machine', type: 'select', required: true, options: machines.filter(m => m.status !== 'Breakdown').map(m => ({ value: m.id, label: `${m.code} ${m.name}` })) },
            { key: 'by', label: 'Raised by', type: 'select', options: operators.map(e => ({ value: e.id, label: e.name })) },
            { key: 'problem', label: 'Problem', type: 'textarea', required: true },
          ]}
          onSubmit={v => { const r = act(d => raiseBreakdown(d, v.machineId, v.problem, v.by)); if (r) return r; notify('Ticket raised; maintenance alerted', 'warn'); }} />
      )}
      {restore && (
        <FormModal title="Restore machine" onClose={() => setRestore(null)} submitLabel="Machine restored" initial={{ minutes: 90, work: '', spare: '', qty: 1, cost: 0 }}
          fields={[
            { key: 'work', label: 'Work done', type: 'textarea', required: true },
            { key: 'minutes', label: 'Minutes down', type: 'number', required: true },
            { key: 'spare', label: 'Spare issued (optional)', type: 'select', options: [{ value: '', label: 'None' }, { value: 'Bearing 6205', label: 'Bearing 6205' }, { value: 'Hydraulic hose 1/2"', label: 'Hydraulic hose 1/2"' }, { value: 'Die insert M16', label: 'Die insert M16' }] },
            { key: 'qty', label: 'Qty', type: 'number' }, { key: 'cost', label: 'Cost each (₹)', type: 'number' },
          ]}
          onSubmit={v => {
            const r = act(d => restoreMachine(d, restore, v.work, Number(v.minutes), v.spare ? [{ name: v.spare, qty: Number(v.qty) || 1, cost: Number(v.cost) || 0 }] : []));
            if (r) return r; notify('Machine restored; downtime booked on the job card');
          }} />
      )}
    </>
  );
}
