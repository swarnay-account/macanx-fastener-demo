import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { Search, Bell, RotateCcw, ChevronDown, LogOut, Menu, X, ArrowRight, Route } from 'lucide-react';
import { useDB, act, resetDemo } from '../data/store';
import { FLOW, PLANT, MANAGE, ACCESS, ROLES, go, useRoute, homeFor, type ModuleDef } from '../modules';
import type { StockStatus, Stage, Role, Plant } from '../data/types';
import { STAGES } from '../lib/plant';
import { stockOf } from '../lib/plant';
import { num } from '../lib/format';
import { identify } from '../lib/trace';
import { Confirm, notify } from './ui';

export function HexMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="hexmark">
      <path d="M16 3.5 26.8 9.75v12.5L16 28.5 5.2 22.25V9.75z" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="4.6" fill="none" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}

/* ---------- sidebar ---------- */
function NavGroup({ title, items, route, role, onPick }: { title: string; items: ModuleDef[]; route: string; role: Role; onPick: () => void }) {
  const allowed = items.filter(m => ACCESS[role].includes(m.id));
  if (!allowed.length) return null;
  return (
    <div className="nav-group">
      <span className="nav-group__title">{title}</span>
      {allowed.map(m => (
        <button key={m.id} className={`nav-item${route === m.id ? ' is-active' : ''}`} onClick={() => { go(m.id); onPick(); }}>
          {m.step ? <span className="nav-item__step">{m.step}</span> : <m.icon size={16} strokeWidth={1.8} className="nav-item__icon" />}
          <span>{m.title}</span>
        </button>
      ))}
    </div>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB();
  const route = useRoute();
  return (
    <>
      <aside className={`sidebar${open ? ' is-open' : ''}`}>
        <div className="sidebar__brand">
          <HexMark />
          <div><strong>Fastener ERP</strong><span>West Coast Corrotech, Fastener Division</span></div>
          <button className="icon-btn sidebar__close" onClick={onClose} aria-label="Close menu"><X size={18} /></button>
        </div>
        <nav className="sidebar__nav" aria-label="Modules">
          <NavGroup title="Management" items={MANAGE.slice(0, 1)} route={route} role={db.role} onPick={onClose} />
          <NavGroup title="Client PO to invoice" items={FLOW} route={route} role={db.role} onPick={onClose} />
          <NavGroup title="Across the plant" items={PLANT} route={route} role={db.role} onPick={onClose} />
          <NavGroup title="Office" items={MANAGE.slice(1)} route={route} role={db.role} onPick={onClose} />
        </nav>
        <div className="sidebar__foot">Built by MacanX. Sample data.</div>
      </aside>
      {open && <div className="scrim" onClick={onClose} />}
    </>
  );
}

/* ---------- top bar ---------- */
export function Topbar({ onMenu, onExit }: { onMenu: () => void; onExit: () => void }) {
  const db = useDB();
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState(false);
  const [reset, setReset] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const pending = db.approvals.filter(a => a.state === 'Pending' && (a.approverRole === db.role || db.role === 'Management' || db.role === 'Admin')).length;
  const person = db.employees.find(e => e.role === db.role)?.name ?? db.role;

  const trace = () => {
    const hit = identify(db, q);
    if (!hit) { notify(`Nothing found for “${q}”. Try a pack, lot, heat, dispatch or invoice number.`, 'warn'); return; }
    go('trace', `${hit.kind}:${hit.id}`);
    setQ('');
  };
  const setRole = (role: Role) => {
    act(d => { d.role = role; });
    if (!ACCESS[role].includes(window.location.hash.replace(/^#\/?/, '') as never)) go(homeFor(role));
    notify(`Now viewing as ${role}. Menus and approvals follow this role.`, 'info');
  };

  return (
    <header className="topbar">
      <button className="icon-btn topbar__menu" onClick={onMenu} aria-label="Open menu"><Menu size={20} /></button>
      <div className="plant-switch" role="radiogroup" aria-label="Plant">
        {(['AHD', 'MUN'] as Plant[]).map(p => (
          <button key={p} role="radio" aria-checked={db.plant === p} className={db.plant === p ? 'is-on' : ''} onClick={() => act(d => { d.plant = p; })}>
            {p === 'AHD' ? 'Ahmedabad' : 'Mundra SEZ'}
          </button>
        ))}
      </div>
      <form className="trace-box" onSubmit={e => { e.preventDefault(); trace(); }}>
        <Route size={16} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Trace a pack, lot or heat no." aria-label="Trace a pack, lot or heat number" />
        <button type="submit" className="icon-btn icon-btn--sm" aria-label="Trace"><Search size={15} /></button>
      </form>
      <span className="grow" />
      <button className="bell" onClick={() => go(ACCESS[db.role].includes('approvals') ? 'approvals' : homeFor(db.role))} aria-label={`${pending} approvals waiting`}>
        <Bell size={18} />{pending > 0 && <span>{pending}</span>}
      </button>
      <div className="role" ref={ref}>
        <button className="role__btn" onClick={() => setMenu(m => !m)}>
          <span className="role__avatar">{person.split(' ').map(w => w[0]).slice(0, 2).join('')}</span>
          <span className="role__who"><strong>{person}</strong><small>{db.role}</small></span>
          <ChevronDown size={15} />
        </button>
        {menu && (
          <div className="menu">
            <p className="menu__note">Switch role to see the screens and approvals each person gets.</p>
            <div className="menu__roles">
              {ROLES.map(r => <button key={r} className={r === db.role ? 'is-on' : ''} onClick={() => { setRole(r); setMenu(false); }}>{r}</button>)}
            </div>
            <hr />
            <button className="menu__row" onClick={() => { setMenu(false); setReset(true); }}><RotateCcw size={15} />Reset demo data</button>
            <button className="menu__row" onClick={() => { setMenu(false); onExit(); }}><LogOut size={15} />Leave the demo</button>
          </div>
        )}
      </div>
      {reset && <Confirm title="Reset demo data?" danger okLabel="Reset" text="Everything you entered is cleared and the sample plant is restored." onOk={() => { resetDemo(); notify('Sample plant restored'); }} onClose={() => setReset(false)} />}
    </header>
  );
}

export function PageHead({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head__row">
        <div>
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
        {actions && <div className="page-head__actions">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/* ---------- plant vocabulary ---------- */
export function Code({ children }: { children: ReactNode }) { return <span className="code">{children}</span>; }

const STATUS_CLASS: Record<StockStatus, string> = {
  'Quality hold': 'hold', Free: 'free', Reserved: 'reserved', Rejected: 'rejected', 'In transit': 'transit', 'With job worker': 'jobwork',
};
export function StockBadge({ status }: { status: StockStatus }) {
  return <span className={`sbadge sbadge--${STATUS_CLASS[status]}`}>{status}</span>;
}

/** The plant's stages as one strip: the signature of this ERP. */
export function StageRail({ onPick, active, soId }: { onPick?: (s: Stage) => void; active?: Stage | null; soId?: string }) {
  const db = useDB();
  const prodItems = new Set(db.items.filter(i => i.type !== 'Consumable' && i.type !== 'Scrap').map(i => i.id));
  const ledger = db.ledger.filter(r => prodItems.has(r.itemId) && r.plant === db.plant);
  return (
    <ol className="rail">
      {STAGES.map(s => {
        const all = stockOf(ledger, { stage: s.id, soId });
        const hold = stockOf(ledger, { stage: s.id, status: 'Quality hold', soId });
        return (
          <li key={s.id} className={active === s.id ? 'is-active' : ''}>
            <button onClick={() => onPick?.(s.id)} disabled={!onPick}>
              <span className="rail__name">{s.name}</span>
              <span className="rail__kg">{num(all.kg)}<small> kg</small></span>
              <span className="rail__pcs">{s.id === 'RM' || s.id === 'DRAWN' ? ' ' : `${num(all.pcs)} pcs`}</span>
              {hold.kg > 0 && <span className="rail__hold">{num(hold.kg)} kg on hold</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function Qr({ text, size = 96 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(text, { margin: 0, width: size * 2, color: { dark: '#22282e', light: '#ffffff' } }).then(setSrc).catch(() => setSrc('')); }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt={`QR code for ${text}`} className="qr" /> : <span className="qr qr--empty" style={{ width: size, height: size }} />;
}

/** A line's journey from ordered to invoiced, as stepped bars. */
export function StepBars({ steps, total }: { steps: { label: string; value: number; skipped?: boolean }[]; total: number }) {
  return (
    <ol className="steps">
      {steps.map(s => (
        <li key={s.label} className={s.skipped ? 'is-skipped' : ''}>
          <span className="steps__label">{s.label}</span>
          <span className="steps__bar"><i style={{ width: `${Math.min(100, total ? (s.value / total) * 100 : 0)}%` }} /></span>
          <span className="steps__val">{s.skipped ? 'Not needed' : num(s.value)}</span>
        </li>
      ))}
    </ol>
  );
}

export function Welcome({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="welcome">
      <div className="welcome__inner">
        <div className="welcome__brand"><HexMark size={40} /><span>Fastener ERP</span></div>
        <h1>Client PO to invoice, every gram on one ledger.</h1>
        <p className="welcome__lead">
          A working demo of the ERP MacanX is building for West Coast Corrotech's fastener plant. It holds a month of sample
          work: transmission tower orders through heading, threading, heat treatment, galvanising, TPI, MDCC and dispatch.
        </p>
        <ol className="welcome__flow">
          {['Sales order', 'Planning', 'Purchase', 'Inward & QC', 'Production', 'Galvanising', 'Packing & TPI', 'MDCC', 'Dispatch & billing'].map((s, i) => (
            <li key={s}><b>{i + 1}</b>{s}</li>
          ))}
        </ol>
        <button className="btn btn--signal btn--lg" onClick={onEnter} autoFocus>Open the plant <ArrowRight size={18} /></button>
        <p className="welcome__fine">Sample data only. Changes stay in this browser and can be reset at any time.</p>
      </div>
    </div>
  );
}

export function NoAccess({ role }: { role: Role }) {
  return (
    <div className="empty empty--page">
      <h2>{role} does not use this screen</h2>
      <p>Access is set per role. Switch role from the top bar, or go to this role's own screens.</p>
      <button className="btn btn--primary" onClick={() => go(homeFor(role))}>Go to {role} home</button>
    </div>
  );
}
