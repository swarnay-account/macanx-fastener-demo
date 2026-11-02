import { useState } from 'react';

const FOREST = '#2F5D8C';
const GOLD = '#C99400';
const PALETTE = ['#2F5D8C', '#C99400', '#5E7A8F', '#E4C25A', '#8FA6B8', '#7A5B00', '#B7C3CC', '#3E4A54'];

export function Sparkline({ data, color = FOREST, w = 64, h = 22 }: { data: number[]; color?: string; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / (max - min || 1)) * (h - 4)}`).join(' ');
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function MiniBars({ data, color = GOLD }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1);
  return (
    <svg width={58} height={22} viewBox="0 0 58 22" aria-hidden="true">
      {data.map((v, i) => <rect key={i} x={i * 8.5} y={22 - (v / max) * 20 - 2} width={5.5} height={(v / max) * 20 + 2} rx={1.5} fill={color} />)}
    </svg>
  );
}

/** Area line for "sales over time", with a hover readout. */
export function TrendLine({ points, format }: { points: { label: string; value: number }[]; format: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 200, P = 8;
  const max = Math.max(...points.map(p => p.value), 1);
  const x = (i: number) => P + (i / Math.max(1, points.length - 1)) * (W - P * 2);
  const y = (v: number) => H - 24 - (v / max) * (H - 44);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${H - 24} L${x(0)},${H - 24} Z`;
  const h = hover ?? points.length - 1;
  return (
    <div className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Sales trend"
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}>
        <defs>
          <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={FOREST} stopOpacity="0.16" />
            <stop offset="1" stopColor={FOREST} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(f => <line key={f} x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} stroke="var(--rule)" strokeDasharray="3 4" />)}
        <path d={area} fill="url(#trendFill)" />
        <path d={line} fill="none" stroke={FOREST} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <line x1={x(h)} x2={x(h)} y1={8} y2={H - 24} stroke={GOLD} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <circle cx={x(h)} cy={y(points[h].value)} r="4" fill="#fff" stroke={FOREST} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="trend__readout"><strong>{format(points[h].value)}</strong><span>{points[h].label}</span></div>
      <div className="trend__axis"><span>{points[0]?.label}</span><span>{points[Math.floor(points.length / 2)]?.label}</span><span>{points[points.length - 1]?.label}</span></div>
    </div>
  );
}

export function Donut({ data, center, sub, format }: { data: { label: string; value: number }[]; center: string; sub: string; format: (n: number) => string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="Category split">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--zinc-2)" strokeWidth="16" />
        {data.map((d, i) => {
          const len = (d.value / total) * C;
          const el = <circle key={d.label} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="16"
            strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />;
          acc += len;
          return el;
        })}
        <text x="70" y="68" textAnchor="middle" className="donut__center">{center}</text>
        <text x="70" y="86" textAnchor="middle" className="donut__sub">{sub}</text>
      </svg>
      <ul className="legend">
        {data.map((d, i) => (
          <li key={d.label}><i style={{ background: PALETTE[i % PALETTE.length] }} /><span>{d.label}</span><strong>{format(d.value)}</strong></li>
        ))}
      </ul>
    </div>
  );
}

export function HBars({ data, format }: { data: { label: string; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <ul className="hbars">
      {data.map(d => (
        <li key={d.label}>
          <div className="hbars__row"><span>{d.label}</span><strong>{format(d.value)}</strong></div>
          <div className="hbars__track"><div style={{ width: `${(d.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
