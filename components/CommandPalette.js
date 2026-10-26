'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, fmtMoney, can, statusLabel } from '@/lib/client.js';
import { Icon } from './icons.js';

/* ------------------------------ static config ----------------------------- */

/* Navigation + action entries. `roles: '*'` means every signed-in user.
   Actions append `?new=1`, which each module's page already understands. */
const ENTRIES = [
  { group: 'Navigate', kind: 'nav', icon: 'grid', title: 'Dashboard', href: '/dashboard', roles: '*' },
  { group: 'Navigate', kind: 'nav', icon: 'users', title: 'Patients', href: '/patients', roles: ['admin', 'doctor', 'receptionist', 'lab'] },
  { group: 'Navigate', kind: 'nav', icon: 'steth', title: 'Doctors', href: '/doctors', roles: ['admin', 'receptionist', 'patient', 'doctor'] },
  { group: 'Navigate', kind: 'nav', icon: 'calendar', title: 'Appointments', href: '/appointments', roles: ['admin', 'receptionist', 'patient', 'doctor'] },
  { group: 'Navigate', kind: 'nav', icon: 'clipboard', title: 'Medical Records', href: '/records', roles: ['admin', 'doctor', 'patient'] },
  { group: 'Navigate', kind: 'nav', icon: 'flask', title: 'Laboratory', href: '/labs', roles: ['admin', 'doctor', 'lab', 'patient'] },
  { group: 'Navigate', kind: 'nav', icon: 'pill', title: 'Prescriptions', href: '/prescriptions', roles: ['admin', 'doctor', 'patient'] },
  { group: 'Navigate', kind: 'nav', icon: 'receipt', title: 'Billing', href: '/billing', roles: ['admin', 'receptionist', 'patient'] },
  { group: 'Navigate', kind: 'nav', icon: 'chart', title: 'Reports', href: '/reports', roles: ['admin', 'doctor', 'receptionist'] },
  { group: 'Navigate', kind: 'nav', icon: 'gear', title: 'Administration', href: '/admin', roles: ['admin'] },

  { group: 'Actions', kind: 'action', icon: 'plus', title: 'Register a patient', href: '/patients?new=1', roles: ['admin', 'receptionist'], cap: 'patient:create' },
  { group: 'Actions', kind: 'action', icon: 'calendar', title: 'Book an appointment', href: '/appointments?new=1', roles: ['admin', 'receptionist', 'patient'], cap: 'appointment:book' },
  { group: 'Actions', kind: 'action', icon: 'clipboard', title: 'Record a consultation', href: '/records?new=1', roles: ['admin', 'doctor'], cap: 'record:create' },
  { group: 'Actions', kind: 'action', icon: 'pill', title: 'Write a prescription', href: '/prescriptions?new=1', roles: ['admin', 'doctor'], cap: 'rx:create' },
  { group: 'Actions', kind: 'action', icon: 'flask', title: 'Order a lab test', href: '/labs?new=1', roles: ['admin', 'doctor', 'receptionist'], cap: 'lab:order' },
  { group: 'Actions', kind: 'action', icon: 'receipt', title: 'Create an invoice', href: '/billing?new=1', roles: ['admin', 'receptionist'], cap: 'invoice:create' },
  { group: 'Actions', kind: 'action', icon: 'gear', title: 'Add a user account', href: '/admin', roles: ['admin'], cap: 'admin:manage' },
];

/* Remote record types searched while typing (each is role-gated server-side
   too — the palette only queries endpoints the role may read). */
const SEARCH_SOURCES = [
  {
    group: 'Patients', icon: 'users',
    allowed: ['admin', 'doctor', 'receptionist', 'lab'],
    fetch: (q) => api(`/api/patients?search=${encodeURIComponent(q)}`).then((d) => (d.patients || []).slice(0, 5)),
    toItem: (p) => ({
      title: p.name,
      sub: `${p.patient_code}${p.phone ? ` · ${p.phone}` : ''}`,
      href: `/patients/${p.id}`,
    }),
  },
  {
    group: 'Doctors', icon: 'steth',
    allowed: ['admin', 'receptionist', 'patient', 'doctor'],
    fetch: (q) => api(`/api/doctors`).then((d) =>
      (d.doctors || [])
        .filter((x) => x.name.toLowerCase().includes(q) || String(x.specialization || '').toLowerCase().includes(q))
        .slice(0, 4)
    ),
    toItem: (d) => ({ title: d.name, sub: `${d.specialization} · ${fmtMoney(d.fee)} consultation`, href: '/doctors' }),
  },
  {
    group: 'Appointments', icon: 'calendar',
    allowed: ['admin', 'receptionist', 'patient', 'doctor'],
    fetch: (q) => api(`/api/appointments?q=${encodeURIComponent(q)}&limit=6`).then((d) => (d.appointments || []).slice(0, 4)),
    toItem: (a) => ({
      title: `${a.patient_name} · ${a.doctor_name}`,
      sub: `${a.date} ${a.time} · ${statusLabel(a.status)}`,
      href: '/appointments',
    }),
  },
  {
    group: 'Invoices', icon: 'receipt',
    allowed: ['admin', 'receptionist', 'patient'],
    fetch: (q) => api(`/api/invoices?q=${encodeURIComponent(q)}`).then((d) => (d.invoices || []).slice(0, 4)),
    toItem: (i) => ({
      title: `${i.invoice_no} · ${i.patient_name}`,
      sub: `${fmtMoney(i.total)} · ${statusLabel(i.status)}`,
      href: '/billing',
    }),
  },
];

/* -------------------------------- component ------------------------------- */

export default function CommandPalette({ open, onClose, user }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState({ items: [], loading: false });
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  /* focus the input whenever the palette opens */
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  /* escape closes (capture phase so it wins over other handlers) */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  /* local entries (nav + actions) filtered by role and query */
  const localItems = useMemo(() => {
    const t = query.trim().toLowerCase();
    return ENTRIES.filter((e) => {
      if (!user) return false;
      if (e.roles !== '*' && !e.roles.includes(user.role)) return false;
      if (e.cap && !can(user, e.cap)) return false;
      if (!t) return e.group === 'Navigate' || e.kind === 'action';
      return e.title.toLowerCase().includes(t);
    }).map((e) => ({ ...e, sub: e.kind === 'action' ? 'Quick action' : 'Go to page' }));
  }, [query, user]);

  /* remote record search, debounced */
  const q = query.trim().toLowerCase();
  useEffect(() => {
    if (!open || !user || q.length < 2) {
      setRemote({ items: [], loading: false });
      return undefined;
    }
    let alive = true;
    setRemote((r) => ({ items: r.items, loading: true }));
    const sources = SEARCH_SOURCES.filter((s) => s.allowed.includes(user.role));
    const timer = setTimeout(() => {
      Promise.allSettled(sources.map((s) => s.fetch(q))).then((results) => {
        if (!alive) return;
        const items = [];
        results.forEach((res, i) => {
          if (res.status !== 'fulfilled') return;
          const s = sources[i];
          (res.value || []).forEach((record) => {
            const mapped = s.toItem(record);
            if (mapped) items.push({ group: s.group, icon: s.icon, kind: 'record', ...mapped });
          });
        });
        setRemote({ items: items.slice(0, 12), loading: false });
      });
    }, 260);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, open, user]);

  /* combined list, grouped */
  const items = useMemo(() => [...localItems, ...remote.items], [localItems, remote.items]);

  useEffect(() => {
    setActive(0);
  }, [query, remote.items]);

  /* keep the highlighted row in view while arrowing */
  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, items]);

  const run = useCallback(
    (item) => {
      if (!item) return;
      onClose();
      router.push(item.href);
    },
    [onClose, router]
  );

  const onInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[active]);
    } else if (e.key === 'Home') {
      setActive(0);
    } else if (e.key === 'End') {
      setActive(Math.max(0, items.length - 1));
    }
  };

  if (!open) return null;

  /* group items for rendering with headers */
  const groups = [];
  items.forEach((item, i) => {
    const last = groups[groups.length - 1];
    if (last && last.group === item.group) last.indexes.push(i);
    else groups.push({ group: item.group, indexes: [i] });
  });

  return (
    <div className="cmdk-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search and commands">
        <div className="cmdk-input-row">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Search patients, doctors, appointments or jump to a page…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? `cmdk-opt-${active}` : undefined}
            aria-label="Search and commands"
          />
          <span className="kbd">Esc</span>
        </div>

        <div className="cmdk-results" id="cmdk-list" role="listbox" aria-label="Results" ref={listRef}>
          {items.length === 0 ? (
            <div className="cmdk-empty">
              {remote.loading ? (
                <span>Searching…</span>
              ) : q.length >= 2 ? (
                <span>No matches for “{query.trim()}”.</span>
              ) : (
                <span>Type to search, or pick a page below.</span>
              )}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.group}>
                <div className="cmdk-group">{g.group}</div>
                {g.indexes.map((i) => {
                  const item = items[i];
                  return (
                    <button
                      type="button"
                      key={`${item.group}-${item.title}-${i}`}
                      id={`cmdk-opt-${i}`}
                      className="cmdk-item"
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => run(item)}
                    >
                      <span className="ci-ico">
                        <Icon name={item.icon} size={16} />
                      </span>
                      <span className="ci-main">
                        <span className="ci-title">{item.title}</span>
                        {item.sub ? <span className="ci-sub">{item.sub}</span> : null}
                      </span>
                      {item.kind === 'nav' || item.kind === 'action' ? (
                        <span className="ci-hint">
                          <Icon name="chevronRight" size={13} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="cmdk-foot">
          <span className="cf">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> navigate
          </span>
          <span className="cf">
            <span className="kbd">↵</span> open
          </span>
          <span className="cf">
            <span className="kbd">Esc</span> close
          </span>
          <span className="cf right-gap" style={{ marginLeft: 'auto' }}>
            <Icon name="lock" size={12} /> Results respect your role permissions
          </span>
        </div>
      </div>
    </div>
  );
}
