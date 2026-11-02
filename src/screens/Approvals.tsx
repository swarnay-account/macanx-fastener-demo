import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useDB, act } from '../data/store';
import { PageHead } from '../components/shell';
import { Button, Badge, DataTable, Tabs, notify } from '../components/ui';
import { inr, niceDate } from '../lib/format';
import { decide } from '../lib/actions';

/** Default approval matrix from the scope; editable by admin in the delivered system. */
const MATRIX: [string, string][] = [
  ['Indent', 'Head of department; plant head above ₹5 lakh'],
  ['Purchase Order', 'Purchase head; management above ₹10 lakh'],
  ['Non-lowest vendor', 'Reason required, plus management'],
  ['SO and SO amendment', 'Sales head'],
  ['Sourcing split (outsourcing)', 'Plant head'],
  ['Quality deviation', 'QC head'],
  ['Work order with partial RM', 'Plant head'],
  ['Stock adjustment', 'Stores head; management above ₹50,000'],
  ['Correction after shift close', 'Production supervisor'],
];

export function Approvals() {
  const db = useDB();
  const [tab, setTab] = useState<'mine' | 'all' | 'matrix'>('mine');
  const mine = db.approvals.filter(a => a.state === 'Pending' && (a.approverRole === db.role || db.role === 'Management' || db.role === 'Admin'));
  const rows = tab === 'mine' ? mine : db.approvals;
  const run = (id: string, ok: boolean) => {
    const r = act(d => decide(d, id, ok));
    if (r) notify(r, 'warn'); else notify(ok ? 'Approved' : 'Rejected', ok ? 'ok' : 'warn');
  };
  return (
    <>
      <PageHead title="Approvals" sub={`Showing what ${db.role} can decide. Approvals also work from the mobile app and from a link in email.`} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'mine', label: 'Waiting for me', count: mine.length }, { id: 'all', label: 'All decisions', count: db.approvals.length }, { id: 'matrix', label: 'Who approves what' }]} />
      {tab === 'matrix' ? (
        <div className="table-card"><table className="table"><thead><tr><th>Document</th><th>Who approves</th></tr></thead>
          <tbody>{MATRIX.map(([d, w]) => <tr key={d}><td>{d}</td><td>{w}</td></tr>)}</tbody></table></div>
      ) : (
        <DataTable rows={rows} pageSize={12} empty={tab === 'mine' ? 'Nothing is waiting for you. Switch role from the top bar to see other people’s approvals.' : 'No approvals yet.'} columns={[
          { key: 'd', label: 'Raised', render: a => niceDate(a.date) },
          { key: 'k', label: 'Type', render: a => <Badge tone="grey">{a.kind}</Badge> },
          { key: 't', label: 'What', render: a => a.text },
          { key: 'v', label: 'Value', align: 'right', render: a => a.value ? inr(a.value) : '—' },
          { key: 'r', label: 'Approver', render: a => a.approverRole },
          { key: 's', label: 'State', render: a => <Badge tone={a.state === 'Approved' ? 'green' : a.state === 'Rejected' ? 'red' : 'gold'}>{a.state}{a.decidedBy ? ` by ${a.decidedBy}` : ''}</Badge> },
        ]} actions={a => a.state === 'Pending' ? <>
          <Button small variant="ghost" icon={<X size={14} />} onClick={() => run(a.id, false)}>Reject</Button>
          <Button small variant="signal" icon={<Check size={14} />} onClick={() => run(a.id, true)}>Approve</Button>
        </> : null} />
      )}
    </>
  );
}
