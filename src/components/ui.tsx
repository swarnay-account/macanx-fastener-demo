import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronUp, ChevronDown, Inbox, CheckCircle2, AlertTriangle, Info, ChevronLeft, ChevronRight } from 'lucide-react';

/* ---------- Button ---------- */
type BtnVariant = 'primary' | 'signal' | 'gold' | 'ghost' | 'danger' | 'soft';
export function Button({ variant = 'primary', icon, children, small, ...rest }:
  { variant?: BtnVariant; icon?: ReactNode; small?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={`btn btn--${variant}${small ? ' btn--sm' : ''} ${rest.className ?? ''}`}>
      {icon}{children && <span>{children}</span>}
    </button>
  );
}

/* ---------- Badge ---------- */
export type Tone = 'green' | 'gold' | 'red' | 'blue' | 'grey' | 'purple';
export function Badge({ tone = 'grey', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/* ---------- Toasts ---------- */
type Toast = { id: number; text: string; tone: 'ok' | 'warn' | 'info' };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
export function notify(text: string, tone: Toast['tone'] = 'ok') {
  const t = { id: Date.now() + Math.random(), text, tone };
  toasts = [...toasts, t];
  toastListeners.forEach(l => l());
  setTimeout(() => { toasts = toasts.filter(x => x.id !== t.id); toastListeners.forEach(l => l()); }, 3600);
}
export function ToastHost() {
  const list = useSyncExternalStore(fn => { toastListeners.add(fn); return () => toastListeners.delete(fn); }, () => toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={`toast toast--${t.tone}`}>
          {t.tone === 'ok' ? <CheckCircle2 size={18} /> : t.tone === 'warn' ? <AlertTriangle size={18} /> : <Info size={18} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Modal ---------- */
export function Modal({ title, subtitle, onClose, children, footer, wide }:
  { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Confirm ---------- */
export function Confirm({ title, text, okLabel = 'Confirm', danger, onOk, onClose }:
  { title: string; text: string; okLabel?: string; danger?: boolean; onOk: () => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onOk(); onClose(); }}>{okLabel}</Button>
    </>}>
      <p className="muted">{text}</p>
    </Modal>
  );
}

/* ---------- Form fields ---------- */
export type FieldSpec = {
  key: string; label: string; type?: 'text' | 'number' | 'select' | 'date' | 'textarea' | 'checkbox';
  options?: { value: string; label: string }[]; required?: boolean; step?: string; hint?: string; full?: boolean; min?: number;
};
type Values = Record<string, any>;

export function FormModal({ title, subtitle, fields, initial, onSubmit, onClose, submitLabel = 'Save', aside }:
  { title: string; subtitle?: string; fields: FieldSpec[]; initial: Values; submitLabel?: string;
    onSubmit: (v: Values) => string | void; onClose: () => void; aside?: (v: Values) => ReactNode }) {
  const [values, setValues] = useState<Values>(initial);
  const [error, setError] = useState('');
  const set = (k: string, v: unknown) => setValues(s => ({ ...s, [k]: v }));
  const submit = () => {
    for (const f of fields) {
      if (f.required && (values[f.key] === '' || values[f.key] === undefined || values[f.key] === null)) {
        setError(`${f.label} is required.`); return;
      }
    }
    const res = onSubmit(values);
    if (typeof res === 'string') setError(res); else onClose();
  };
  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button onClick={submit}>{submitLabel}</Button>
    </>}>
      <form className="form-grid" onSubmit={e => { e.preventDefault(); submit(); }}>
        {fields.map(f => <Field key={f.key} spec={f} value={values[f.key]} onChange={v => { set(f.key, v); setError(''); }} />)}
        <button type="submit" hidden />
      </form>
      {aside && <div className="form-aside">{aside(values)}</div>}
      {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
    </Modal>
  );
}

export function Field({ spec, value, onChange }: { spec: FieldSpec; value: any; onChange: (v: any) => void }) {
  const id = `f-${spec.key}`;
  const type = spec.type ?? 'text';
  let control: ReactNode;
  if (type === 'select') {
    control = (
      <select id={id} value={value ?? ''} onChange={e => onChange(e.target.value)}>
        <option value="" disabled>Select…</option>
        {spec.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else if (type === 'textarea') {
    control = <textarea id={id} value={value ?? ''} rows={3} onChange={e => onChange(e.target.value)} />;
  } else if (type === 'checkbox') {
    return (
      <label className={`field field--check${spec.full ? ' field--full' : ''}`}>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
        <span>{spec.label}</span>
      </label>
    );
  } else {
    control = (
      <input id={id} type={type} value={value ?? ''} step={spec.step ?? (type === 'number' ? 'any' : undefined)} min={spec.min}
        onChange={e => onChange(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />
    );
  }
  return (
    <div className={`field${spec.full || type === 'textarea' ? ' field--full' : ''}`}>
      <label htmlFor={id}>{spec.label}{spec.required && <em>*</em>}</label>
      {control}
      {spec.hint && <small>{spec.hint}</small>}
    </div>
  );
}

/* ---------- Data table ---------- */
export type Column<T> = {
  key: string; label: string; render?: (row: T) => ReactNode; value?: (row: T) => string | number;
  align?: 'right' | 'center'; width?: string;
};
export function DataTable<T extends { id: string }>({ rows, columns, actions, empty = 'Nothing here yet.', pageSize = 10, onRowClick }:
  { rows: T[]; columns: Column<T>[]; actions?: (row: T) => ReactNode; empty?: string; pageSize?: number; onRowClick?: (row: T) => void }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col?.value) return rows;
    return [...rows].sort((a, b) => {
      const x = col.value!(a), y = col.value!(b);
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }, [rows, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const view = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  if (rows.length === 0) {
    return <div className="empty"><Inbox size={28} /><p>{empty}</p></div>;
  }
  return (
    <div className="table-card">
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} style={{ width: c.width, textAlign: c.align }}
                  className={c.value ? 'sortable' : undefined}
                  onClick={() => c.value && setSort(s => s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 })}>
                  {c.label}
                  {sort?.key === c.key && (sort.dir === 1 ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                </th>
              ))}
              {actions && <th style={{ textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {view.map(r => (
              <tr key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'clickable' : undefined}>
                {columns.map(c => (
                  <td key={c.key} style={{ textAlign: c.align }}>{c.render ? c.render(r) : String((r as any)[c.key] ?? '')}</td>
                ))}
                {actions && <td className="row-actions" onClick={e => e.stopPropagation()}>{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <span>{safePage * pageSize + 1}–{Math.min(sorted.length, (safePage + 1) * pageSize)} of {sorted.length}</span>
          <button className="icon-btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
          <button className="icon-btn" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
        </div>
      )}
    </div>
  );
}

/* ---------- Toolbar pieces ---------- */
export function SearchBox({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="search">
      <Search size={17} />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      {value && <button className="icon-btn icon-btn--sm" onClick={() => onChange('')} aria-label="Clear search"><X size={14} /></button>}
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number; icon?: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab${value === t.id ? ' is-active' : ''}`} onClick={() => onChange(t.id)}>
          {t.icon}{t.label}{t.count !== undefined && <span className="tab__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

/* ---------- Stat card ---------- */
export function Stat({ icon, label, value, sub, tone = 'green', spark }:
  { icon: ReactNode; label: string; value: string; sub?: string; tone?: 'green' | 'gold' | 'red'; spark?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat__top">
        <span className="stat__icon">{icon}</span>
        <span className="stat__label">{label}</span>
        {spark && <span className="stat__spark">{spark}</span>}
      </div>
      <div className="stat__value">{value}</div>
      {sub && <div className={`stat__sub stat__sub--${tone}`}>{sub}</div>}
    </div>
  );
}

export function Panel({ eyebrow, title, action, children, className = '' }:
  { eyebrow?: string; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel__head">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h3>{title}</h3>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return <dl className="kv">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export const matches = (q: string, ...fields: (string | number | undefined)[]) =>
  !q || fields.some(f => String(f ?? '').toLowerCase().includes(q.toLowerCase()));
