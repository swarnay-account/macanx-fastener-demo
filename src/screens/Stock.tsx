import { useEffect, useMemo, useState } from 'react';
import { Scale } from 'lucide-react';
import { useDB, act } from '../data/store';
import { PageHead, Code, StageRail, StockBadge } from '../components/shell';
import { Button, Badge, DataTable, FormModal, Tabs, SearchBox, notify, matches } from '../components/ui';
import { num, kgs, niceDate, daysBetween } from '../lib/format';
import { STAGES, stageName, stockOf, round3 } from '../lib/plant';
import { requestAdjustment, item } from '../lib/actions';
import { today } from '../lib/inventory';
import { stageStock } from '../lib/metrics';
import { takeFocus } from '../modules';
import type { Stage, StockStatus } from '../data/types';

export function Stock() {
  const db = useDB();
  const [stage, setStage] = useState<Stage | null>(null);
  const [tab, setTab] = useState<'positions' | 'ledger' | 'stores'>('positions');
  useEffect(() => { const f = takeFocus(); if (f?.startsWith('stage:')) setStage(f.slice(6) as Stage); }, []);
  return (
    <>
      <PageHead title="Stage-wise stock" sub="Calculated from the one stock ledger; nobody types stock in. Pick a stage to see what sits there, by lot and status." />
      <StageRail active={stage} onPick={s => setStage(cur => cur === s ? null : s)} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'positions', label: stage ? `At ${stageName(stage).toLowerCase()}` : 'Stock positions' }, { id: 'ledger', label: 'Stock ledger' }, { id: 'stores', label: 'Stores & consumables' }]} />
      {tab === 'positions' && <Positions stage={stage} />}
      {tab === 'ledger' && <Ledger />}
      {tab === 'stores' && <Stores />}
    </>
  );
}

function Positions({ stage }: { stage: Stage | null }) {
  const db = useDB();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StockStatus | ''>('');
  const [count, setCount] = useState<(typeof rows)[number] | null>(null);
  const rows = useMemo(() => {
    const map = new Map<string, { id: string; itemId: string; stage: Stage; status: StockStatus; soId?: string; lotOrHeat: string; pcs: number; kg: number; since: string }>();
    for (const r of stageStock(db)) {
      const k = `${r.lotOrHeat}|${r.stage}|${r.status}|${r.soId ?? ''}`;
      const e = map.get(k) ?? { id: k, itemId: r.itemId, stage: r.stage, status: r.status, soId: r.soId, lotOrHeat: r.lotOrHeat, pcs: 0, kg: 0, since: r.date };
      e.pcs += r.pcs; e.kg += r.kg; if (r.kg > 0 && r.date > e.since) e.since = r.date;
      map.set(k, e);
    }
    return [...map.values()].filter(e => e.kg > 0.0005).map(e => ({ ...e, kg: round3(e.kg) }))
      .filter(e => (!stage || e.stage === stage) && (!status || e.status === status) && matches(q, e.lotOrHeat, item(db, e.itemId).name, db.orders.find(o => o.id === e.soId)?.no))
      .sort((a, b) => STAGES.findIndex(s => s.id === a.stage) - STAGES.findIndex(s => s.id === b.stage));
  }, [db, stage, status, q]);
  const totals = rows.reduce((s, r) => ({ kg: s.kg + r.kg, pcs: s.pcs + r.pcs }), { kg: 0, pcs: 0 });
  return (
    <>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Lot, heat, item or SO" />
        <select className="select-inline" value={status} onChange={e => setStatus(e.target.value as StockStatus | '')} aria-label="Status">
          <option value="">Every status</option>{(['Quality hold', 'Free', 'Reserved', 'Rejected', 'In transit', 'With job worker'] as StockStatus[]).map(s => <option key={s}>{s}</option>)}
        </select>
        <span className="grow" /><span className="muted">{rows.length} positions holding {kgs(totals.kg)} and {num(totals.pcs)} pcs</span>
      </div>
      <DataTable rows={rows} pageSize={15} columns={[
        { key: 'st', label: 'Stage', render: r => stageName(r.stage) },
        { key: 'lot', label: 'Lot / heat / pack', render: r => <Code>{r.lotOrHeat}</Code> },
        { key: 'it', label: 'Item', render: r => item(db, r.itemId).name },
        { key: 'pcs', label: 'pcs', align: 'right', value: r => r.pcs, render: r => r.pcs ? num(r.pcs) : '—' },
        { key: 'kg', label: 'kg', align: 'right', value: r => r.kg, render: r => num(r.kg, 1) },
        { key: 's', label: 'Status', render: r => <StockBadge status={r.status} /> },
        { key: 'so', label: 'Reserved for', render: r => r.soId ? <Code>{db.orders.find(o => o.id === r.soId)?.no}</Code> : '—' },
        { key: 'age', label: 'Age', align: 'right', value: r => r.since, render: r => `${daysBetween(r.since, today())} d` },
      ]} actions={r => <Button small variant="ghost" icon={<Scale size={14} />} onClick={() => setCount(r)}>Count</Button>} />
      {count && (
        <FormModal title={`Physical count, ${count.lotOrHeat}`} subtitle={`System: ${kgs(count.kg, 1)}${count.pcs ? `, ${num(count.pcs)} pcs` : ''}. Differences above ₹50,000 go to management.`} onClose={() => setCount(null)} submitLabel="Send for approval"
          initial={{ kg: count.kg, reason: '' }} fields={[{ key: 'kg', label: 'Counted kg', type: 'number', required: true, step: '0.1' }, { key: 'reason', label: 'Reason', type: 'textarea', required: true }]}
          onSubmit={v => {
            const diff = round3(Number(v.kg) - count.kg);
            const r = act(d => requestAdjustment(d, { itemId: count.itemId, stage: count.stage, status: count.status, lotOrHeat: count.lotOrHeat, soId: count.soId, kgDiff: diff, pcsDiff: 0, reason: v.reason }));
            if (r) return r;
            notify('Count difference sent for approval');
          }} />
      )}
    </>
  );
}

function Ledger() {
  const db = useDB();
  const [q, setQ] = useState('');
  const rows = [...db.ledger].filter(r => r.plant === db.plant && matches(q, r.lotOrHeat, r.ref, r.type, item(db, r.itemId).name)).reverse();
  return (
    <>
      <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder="Lot, heat, document or type" /><span className="muted small">Every receipt, issue, production, handover, galvanising, packing, dispatch and scrap is one row.</span></div>
      <DataTable rows={rows} pageSize={15} columns={[
        { key: 'd', label: 'Date', render: r => niceDate(r.date) },
        { key: 't', label: 'Movement', render: r => <Badge tone={r.kg >= 0 ? 'blue' : 'grey'}>{r.type}</Badge> },
        { key: 'ref', label: 'Document', render: r => <Code>{r.ref}</Code> },
        { key: 'lot', label: 'Lot / heat', render: r => <Code>{r.lotOrHeat}</Code> },
        { key: 'it', label: 'Item', render: r => item(db, r.itemId).name },
        { key: 'st', label: 'Stage', render: r => stageName(r.stage) },
        { key: 's', label: 'Status', render: r => <StockBadge status={r.status} /> },
        { key: 'p', label: 'pcs', align: 'right', render: r => r.pcs ? num(r.pcs) : '' },
        { key: 'k', label: 'kg', align: 'right', render: r => <span className={r.kg < 0 ? 'tone-red' : ''}>{r.kg ? num(r.kg, 1) : ''}</span> },
        { key: 'u', label: 'By', render: r => <span className="muted small">{r.user}</span> },
      ]} />
    </>
  );
}

function Stores() {
  const db = useDB();
  const items = db.items.filter(i => i.type === 'Consumable' || i.type === 'Scrap' || i.type === 'Raw material').map(i => {
    const s = stockOf(db.ledger.filter(r => r.plant === db.plant), { itemId: i.id });
    return { ...i, kg: s.kg, pcs: s.pcs };
  });
  return <DataTable rows={items} columns={[
    { key: 'c', label: 'Code', render: i => <Code>{i.code}</Code> },
    { key: 'n', label: 'Item', render: i => i.name },
    { key: 't', label: 'Type', render: i => i.type },
    { key: 'q', label: 'In stock', align: 'right', render: i => i.kg ? kgs(i.kg) : i.pcs ? `${num(i.pcs)} nos` : '—' },
    { key: 'r', label: 'Reorder at', align: 'right', render: i => i.reorderKg ? kgs(i.reorderKg) : '—' },
    { key: 's', label: '', render: i => i.reorderKg && i.kg < i.reorderKg ? <Badge tone="red">Below reorder</Badge> : null },
  ]} />;
}
