'use client';

import Link from 'next/link';
import { cloneElement } from 'react';
import { EmptyState } from './ui.js';

/** KPI stat card. */
export function Kpi({ item }) {
  let value = item.value;
  if (item.money) value = item.moneySymbol ? `${item.moneySymbol}${Number(item.value || 0).toLocaleString('en-IN')}` : `₹${Number(item.value || 0).toLocaleString('en-IN')}`;
  else if (typeof item.value === 'number') value = item.value.toLocaleString('en-IN');
  return (
    <div className="kpi k-ico" style={{ '--tint': item.tint || 'var(--brand-50)' }}>
      <span className="k-badge">{item.icon}</span>
      <div className="k-label">{item.label}</div>
      <div className="k-value">{value}</div>
      {item.foot ? <div className="k-foot">{item.foot}</div> : null}
    </div>
  );
}

/** Vertical bar chart (pure CSS). */
export function BarChart({ title, sub, data = [], variant = '', action }) {
  const values = data.map((d) => Number(d.value) || 0);
  const max = Math.max(1, ...values);
  const hasData = values.some((v) => v > 0);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {sub ? <div className="sub">{sub}</div> : null}
        </div>
        {action ? <div className="right">{action}</div> : null}
      </div>
      <div className="card-body">
        {!hasData ? (
          <EmptyState icon="📉" title="No activity in this period" sub="Numbers appear as soon as data is recorded." />
        ) : (
          <div className="chart">
            {data.map((d, i) => (
              <div className="col" key={`${d.label}-${i}`} title={`${d.label}: ${d.value}`}>
                <span className="val">{Number(d.value).toLocaleString('en-IN')}</span>
                <div
                  className={`bar ${variant}`}
                  style={{
                    height: `${Math.max(5, Math.round((Number(d.value) / max) * 112))}px`,
                    animationDelay: `${i * 45}ms`,
                  }}
                />
                <span className="lbl">{d.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Horizontal bars — good for distributions and rankings. */
export function HBarCard({ title, sub, data = [], action, formatter }) {
  const max = Math.max(1, ...data.map((d) => Number(d.value) || 0));
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {sub ? <div className="sub">{sub}</div> : null}
        </div>
        {action ? <div className="right">{action}</div> : null}
      </div>
      <div className="card-body">
        {total === 0 ? (
          <EmptyState icon="🗂" title="Nothing recorded yet" />
        ) : (
          data.map((d) => (
            <div className="hbar" key={d.label}>
              <span className="h-name" title={d.sub ? `${d.label} · ${d.sub}` : d.label}>
                {d.label}
              </span>
              <div className="track">
                <div
                  className="fill"
                  style={{
                    width: `${Math.max(3, (Number(d.value) / max) * 100)}%`,
                    ...(d.color ? { background: d.color } : {}),
                  }}
                />
              </div>
              <span className="h-val">{formatter ? formatter(d.value) : d.value}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Donut breakdown (conic-gradient, no canvas) + centre total. */
export function DonutCard({ title, sub, data = [], totalLabel = 'Total', action }) {
  const clean = data.filter((d) => Number(d.value) > 0);
  const total = clean.reduce((s, d) => s + Number(d.value || 0), 0);
  const palette = ['#0d9488', '#16a34a', '#0284c7', '#d97706', '#dc2626', '#7c3aed'];
  let acc = 0;
  const stops = clean.map((d, i) => {
    const start = (acc / Math.max(1, total)) * 360;
    acc += Number(d.value || 0);
    const end = (acc / Math.max(1, total)) * 360;
    return `${d.color || palette[i % palette.length]} ${start}deg ${end}deg`;
  });
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {sub ? <div className="sub">{sub}</div> : null}
        </div>
        {action ? <div className="right">{action}</div> : null}
      </div>
      <div className="card-body">
        {!total ? (
          <EmptyState icon="📊" title="Nothing recorded yet" />
        ) : (
          <div className="donut-card-body">
            <div className="donut" style={{ background: `conic-gradient(${stops.join(', ')})` }} role="img" aria-label={clean.map((d) => `${d.label}: ${d.value}`).join(', ')}>
              <div className="d-center">
                <b>{total.toLocaleString('en-IN')}</b>
                <span>{totalLabel}</span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              {clean.map((d, i) => (
                <div className="flex" key={d.label} style={{ justifyContent: 'space-between', padding: '5px 0', fontSize: 13 }}>
                  <span className="flex" style={{ gap: 8 }}>
                    <span className="dot" style={{ width: 10, height: 10, borderRadius: 3, background: d.color || palette[i % palette.length] }} />
                    <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{d.label}</span>
                  </span>
                  <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {d.value}
                    <span className="dim" style={{ fontWeight: 500 }}>
                      {' '}
                      · {Math.round((Number(d.value) / total) * 100)}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Card containing a scrollable list of rows. */
export function ListCard({
  title,
  sub,
  rows = [],
  renderRow,
  href,
  linkLabel = 'View all',
  emptyIcon = '📭',
  emptyTitle = 'Nothing here yet',
  emptySub,
  action,
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {sub ? <div className="sub">{sub}</div> : null}
        </div>
        {action ? <div className="right">{action}</div> : null}
        {href ? (
          <div className="right">
            <Link href={href} className="btn btn-soft btn-sm">
              {linkLabel} →
            </Link>
          </div>
        ) : null}
      </div>
      {rows.length ? (
        <div className="list">
          {rows.map((row, index) => {
            const el = renderRow(row, index);
            return el && typeof el === 'object'
              ? cloneElement(el, { key: el.key ?? index })
              : el;
          })}
        </div>
      ) : (
        <EmptyState icon={emptyIcon} title={emptyTitle} sub={emptySub} />
      )}
    </div>
  );
}
