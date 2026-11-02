import { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { useDB, act } from '../data/store';
import { PageHead, Code } from '../components/shell';
import { Button, Badge, DataTable, FormModal, Tabs, SearchBox, notify, matches, type FieldSpec } from '../components/ui';
import { num } from '../lib/format';
import { item, ROUTING } from '../lib/actions';
import { log } from '../lib/inventory';
import type { Item, Machine, Party, DB } from '../data/types';

type Tab = 'items' | 'grades' | 'bom' | 'machines' | 'parties' | 'people' | 'reasons';

export function Masters() {
  const db = useDB();
  const [tab, setTab] = useState<Tab>('items');
  return (
    <>
      <PageHead title="Masters" sub="Planning is only as good as the masters behind it. Every item carries kg per 1000 pieces, so every transaction is held in both kg and pieces." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'items', label: 'Items', count: db.items.length }, { id: 'grades', label: 'RM grades', count: db.grades.length }, { id: 'bom', label: 'BOM & routing', count: db.boms.length },
        { id: 'machines', label: 'Machines', count: db.machines.length }, { id: 'parties', label: 'Parties', count: db.parties.length }, { id: 'people', label: 'Employees', count: db.employees.length },
        { id: 'reasons', label: 'Reason codes' },
      ]} />
      {tab === 'items' && <Items />}
      {tab === 'grades' && <DataTable rows={db.grades} columns={[
        { key: 'n', label: 'Grade', render: g => <strong>{g.name}</strong> }, { key: 'c', label: 'C %', render: g => g.c }, { key: 'm', label: 'Mn %', render: g => g.mn },
        { key: 'b', label: 'B %', render: g => g.b ?? '—' }, { key: 't', label: 'Tensile MPa', render: g => g.tensile },
      ]} />}
      {tab === 'bom' && <DataTable rows={db.boms.map(b => ({ ...b, id: b.itemId }))} columns={[
        { key: 'i', label: 'Finished item', render: b => item(db, b.itemId).name },
        { key: 'r', label: 'Raw material', render: b => item(db, b.rmItemId).name },
        { key: 'in', label: 'Input kg / 1000 pcs', align: 'right', render: b => num(b.inputKgPer1000) },
        { key: 'y', label: 'Yield', align: 'right', render: b => `${b.yieldPct}%` },
        { key: 's', label: 'Scrap std', align: 'right', render: b => `${b.scrapPct}%` },
        { key: 'ro', label: 'Routing', render: b => [...(ROUTING[item(db, b.itemId).propertyClass ?? '5.6'] ?? []), 'Galvanising', 'Packing'].join(' → ') },
      ]} />}
      {tab === 'machines' && <Machines />}
      {tab === 'parties' && <Parties />}
      {tab === 'people' && <DataTable rows={db.employees} pageSize={12} columns={[
        { key: 'n', label: 'Name', render: e => e.name }, { key: 'r', label: 'Role', render: e => <Badge tone="grey">{e.role}</Badge> },
        { key: 'p', label: 'Plant', render: e => e.plant === 'AHD' ? 'Ahmedabad' : 'Mundra SEZ' }, { key: 's', label: 'Skilled on', render: e => e.skills.join(', ') || '—' },
      ]} />}
      {tab === 'reasons' && (
        <div className="grid-2">
          {([['Downtime', ['Breakdown', 'Die change', 'No material', 'No power', 'No operator', 'QC hold', 'PM', 'No plan']], ['Rejection', ['Under-size', 'Thread damage', 'Head crack', 'Hardness out', 'Coating short']],
            ['Scrap', ['Process scrap (end cuts, flash)', 'Rejection scrap', 'Setting scrap']], ['Short supply', ['Vendor short', 'Transit loss', 'Weighbridge difference']]] as const).map(([t, list]) => (
            <div className="panel" key={t}><h3 style={{ fontSize: 17, marginBottom: 8 }}>{t}</h3><div className="row">{list.map(r => <Badge key={r} tone="grey">{r}</Badge>)}</div></div>
          ))}
        </div>
      )}
    </>
  );
}

function save<T extends { id: string }>(collection: 'items' | 'machines' | 'parties', id: string | undefined, data: Partial<T>, label: string) {
  act((d: DB) => {
    const arr = d[collection] as unknown as T[];
    if (id) Object.assign(arr.find(x => x.id === id)!, data);
    else arr.push({ ...data, id: `${collection.slice(0, 2)}-${Date.now().toString(36)}` } as T);
    log(d, 'masters', `${label} saved`);
  });
  notify(`${label} saved`);
}

function Items() {
  const db = useDB();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<Item> | null>(null);
  const fields: FieldSpec[] = [
    { key: 'code', label: 'Item code', required: true }, { key: 'name', label: 'Name', required: true },
    { key: 'type', label: 'Type', type: 'select', required: true, options: ['Raw material', 'Consumable', 'Semi-finished', 'Finished', 'Bought-out', 'Scrap'].map(v => ({ value: v, label: v })) },
    { key: 'product', label: 'Product', type: 'select', options: ['', 'Hex bolt', 'Step bolt', 'Hex nut', 'Washer', 'U-bolt', 'Foundation bolt'].map(v => ({ value: v, label: v || '—' })) },
    { key: 'dia', label: 'Size (M)', type: 'number' }, { key: 'length', label: 'Length (mm)', type: 'number' },
    { key: 'propertyClass', label: 'Property class', type: 'select', options: ['', '4.6', '5.6', '8.8', '10.9', '5', '8', '10'].map(v => ({ value: v, label: v || '—' })) },
    { key: 'standard', label: 'Standard', type: 'select', options: ['', 'IS 1363', 'IS 1367', 'IS 12427', 'ISO 4014', 'ISO 4032'].map(v => ({ value: v, label: v || '—' })) },
    { key: 'finish', label: 'Finish', type: 'select', options: ['', 'Black', 'HDG', 'Cold GI', 'Electroplated', 'Plain'].map(v => ({ value: v, label: v || '—' })) },
    { key: 'kgPer1000', label: 'kg per 1000 pcs', type: 'number', required: true, step: '0.1' },
    { key: 'hsn', label: 'HSN', required: true }, { key: 'leadDays', label: 'Lead time (days)', type: 'number' },
    { key: 'source', label: 'Made or bought', type: 'select', options: ['Make', 'Buy', 'Both'].map(v => ({ value: v, label: v })) },
  ];
  return (
    <>
      <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder="Code, name, size" /><span className="grow" /><Button variant="signal" icon={<Plus size={16} />} onClick={() => setEdit({ type: 'Finished', finish: 'HDG', source: 'Make', hsn: '7318', leadDays: 7 })}>New item</Button></div>
      <DataTable rows={db.items.filter(i => matches(q, i.code, i.name, i.dia))} pageSize={12} columns={[
        { key: 'c', label: 'Code', render: i => <Code>{i.code}</Code> }, { key: 'n', label: 'Name', render: i => i.name },
        { key: 't', label: 'Type', render: i => i.type }, { key: 'pc', label: 'Class / std', render: i => [i.propertyClass, i.standard].filter(Boolean).join(', ') || '—' },
        { key: 'k', label: 'kg / 1000', align: 'right', render: i => i.kgPer1000 || '—' }, { key: 'hsn', label: 'HSN', render: i => i.hsn },
        { key: 's', label: 'Source', render: i => i.source },
      ]} actions={i => <button className="icon-btn" title="Edit" onClick={() => setEdit(i)}><Pencil size={15} /></button>} />
      {edit && <FormModal title={edit.id ? `Edit ${edit.code}` : 'New item'} subtitle="After go-live the ERP is the only place where items are created." fields={fields} initial={edit} onClose={() => setEdit(null)}
        onSubmit={v => {
          if (db.items.some(i => i.code === v.code && i.id !== edit.id)) return `Code ${v.code} already exists.`;
          if (['Finished', 'Bought-out', 'Semi-finished'].includes(v.type) && !(Number(v.kgPer1000) > 0)) return 'Pieces items need kg per 1000 pcs, so every transaction can be held in kg and pieces.';
          save<Item>('items', edit.id, { ...v, dia: v.dia ? Number(v.dia) : undefined, length: v.length ? Number(v.length) : undefined, kgPer1000: Number(v.kgPer1000) || 0, leadDays: Number(v.leadDays) || 0 }, `Item ${v.code}`);
        }} />}
    </>
  );
}

function Machines() {
  const db = useDB();
  const [edit, setEdit] = useState<Partial<Machine> | null>(null);
  return (
    <>
      <div className="toolbar"><span className="grow" /><Button variant="signal" icon={<Plus size={16} />} onClick={() => setEdit({ type: 'Header', plant: db.plant, status: 'Idle', ratedKgHr: 0 })}>New machine</Button></div>
      <DataTable rows={db.machines} pageSize={12} columns={[
        { key: 'c', label: 'Machine', render: m => <div className="cell2"><strong>{m.code}</strong><small>{m.name}</small></div> }, { key: 't', label: 'Type', render: m => m.type },
        { key: 'p', label: 'Plant', render: m => m.plant === 'AHD' ? 'Ahmedabad' : 'Mundra SEZ' }, { key: 'r', label: 'Size range', render: m => `M${m.diaMin}–M${m.diaMax}` },
        { key: 'o', label: 'Rated output', align: 'right', render: m => m.ratedPcsHr ? `${num(m.ratedPcsHr)} pcs/h` : `${num(m.ratedKgHr)} kg/h` },
        { key: 'l', label: 'Load limit', align: 'right', render: m => m.loadLimitKg ? `${num(m.loadLimitKg)} kg` : '—' },
      ]} actions={m => <button className="icon-btn" title="Edit" onClick={() => setEdit(m)}><Pencil size={15} /></button>} />
      {edit && <FormModal title={edit.id ? `Edit ${edit.code}` : 'New machine'} initial={edit} onClose={() => setEdit(null)}
        fields={[
          { key: 'code', label: 'Machine ID', required: true }, { key: 'name', label: 'Name', required: true },
          { key: 'type', label: 'Type', type: 'select', options: ['Wire drawing', 'Header', 'Thread roller', 'HT furnace', 'GI kettle', 'Packing'].map(v => ({ value: v, label: v })) },
          { key: 'plant', label: 'Plant', type: 'select', options: [{ value: 'AHD', label: 'Ahmedabad' }, { value: 'MUN', label: 'Mundra SEZ' }] },
          { key: 'section', label: 'Section' }, { key: 'diaMin', label: 'Smallest size (M)', type: 'number', required: true }, { key: 'diaMax', label: 'Largest size (M)', type: 'number', required: true },
          { key: 'ratedPcsHr', label: 'Rated pcs per hour', type: 'number' }, { key: 'ratedKgHr', label: 'Rated kg per hour', type: 'number' }, { key: 'loadLimitKg', label: 'Load limit kg (kettles)', type: 'number' },
        ]}
        onSubmit={v => {
          if (Number(v.diaMin) > Number(v.diaMax)) return 'The smallest size must not be larger than the largest.';
          save<Machine>('machines', edit.id, { ...v, diaMin: Number(v.diaMin), diaMax: Number(v.diaMax), ratedPcsHr: Number(v.ratedPcsHr) || 0, ratedKgHr: Number(v.ratedKgHr) || 0, loadLimitKg: v.loadLimitKg ? Number(v.loadLimitKg) : undefined }, `Machine ${v.code}`);
        }} />}
    </>
  );
}

function Parties() {
  const db = useDB();
  const [edit, setEdit] = useState<Partial<Party> | null>(null);
  return (
    <>
      <div className="toolbar"><span className="grow" /><Button variant="signal" icon={<Plus size={16} />} onClick={() => setEdit({ type: 'Customer' })}>New party</Button></div>
      <DataTable rows={db.parties} pageSize={12} columns={[
        { key: 'n', label: 'Name', render: p => p.name }, { key: 't', label: 'Type', render: p => <Badge tone="grey">{p.type}</Badge> },
        { key: 'c', label: 'City', render: p => p.city }, { key: 'g', label: 'GSTIN', render: p => <Code>{p.gstin}</Code> }, { key: 'tm', label: 'Terms', render: p => p.terms },
      ]} actions={p => <button className="icon-btn" title="Edit" onClick={() => setEdit(p)}><Pencil size={15} /></button>} />
      {edit && <FormModal title={edit.id ? `Edit ${edit.name}` : 'New party'} initial={edit} onClose={() => setEdit(null)}
        fields={[
          { key: 'name', label: 'Name', required: true, full: true }, { key: 'type', label: 'Type', type: 'select', options: ['Customer', 'Supplier', 'Job worker', 'TPI agency'].map(v => ({ value: v, label: v })) },
          { key: 'city', label: 'City', required: true }, { key: 'gstin', label: 'GSTIN', required: true }, { key: 'terms', label: 'Terms' },
        ]}
        onSubmit={v => {
          if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(v.gstin).toUpperCase())) return 'GSTIN should look like 24AAKCS4417M1Z2.';
          save<Party>('parties', edit.id, { ...v, gstin: String(v.gstin).toUpperCase() }, v.name);
        }} />}
    </>
  );
}
