'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, initials, ROLE_LABELS } from '@/lib/client.js';
import { PageSkeleton, Toaster } from './ui.js';
import { Icon, NAV_ICONS } from './icons.js';
import CommandPalette from './CommandPalette.js';
import { useTheme } from '@/lib/theme.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

/* Role-filtered navigation (FR-08 — users only see permitted modules). */
const NAV = [
  {
    label: 'Overview',
    items: [{ href: '/dashboard', key: 'dashboard', text: 'Dashboard', roles: '*' }],
  },
  {
    label: 'Clinical',
    items: [
      { href: '/patients', key: 'patients', text: 'Patients', roles: ['admin', 'doctor', 'receptionist', 'lab'] },
      { href: '/doctors', key: 'doctors', text: 'Doctors', roles: ['admin', 'receptionist', 'patient', 'doctor'] },
      { href: '/appointments', key: 'appointments', text: 'Appointments', roles: ['admin', 'receptionist', 'patient', 'doctor'] },
      { href: '/records', key: 'records', text: 'Medical Records', roles: ['admin', 'doctor', 'patient'] },
      { href: '/labs', key: 'labs', text: 'Laboratory', roles: ['admin', 'doctor', 'lab', 'patient'] },
      { href: '/prescriptions', key: 'prescriptions', text: 'Prescriptions', roles: ['admin', 'doctor', 'patient'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/billing', key: 'billing', text: 'Billing', roles: ['admin', 'receptionist', 'patient'] },
      { href: '/reports', key: 'reports', text: 'Reports', roles: ['admin', 'doctor', 'receptionist'] },
    ],
  },
  {
    label: 'System',
    items: [{ href: '/admin', key: 'admin', text: 'Administration', roles: ['admin'] }],
  },
];

const RAIL_KEY = 'his_rail';

/* --------------------------- click-outside hook --------------------------- */

function useClickOutside(ref, onOutside, active) {
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onOutside();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, onOutside, active]);
}

/* -------------------------------- shell ---------------------------------- */

export default function AppShell({ title, crumb, children }) {
  const [user, setUser] = useState(undefined); // undefined = checking
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const userChipRef = useState(() => ({ current: null }))[0];
  const pathname = usePathname();
  const router = useRouter();
  const theme = useTheme();

  useEffect(() => {
    let alive = true;
    api('/api/auth/me')
      .then((d) => alive && setUser(d.user))
      .catch(() => alive && setUser(null));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (user === null) router.replace('/login');
  }, [user, router]);

  /* collapsed-rail preference */
  useEffect(() => {
    try {
      setRail(localStorage.getItem(RAIL_KEY) === '1');
    } catch {
      /* ignore */
    }
  }, []);

  const toggleRail = () => {
    setRail((r) => {
      const next = !r;
      try {
        localStorage.setItem(RAIL_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  /* close overlays when the route changes */
  useEffect(() => {
    setOpen(false);
    setUserMenu(false);
  }, [pathname]);

  /* ⌘K / Ctrl+K opens the command palette from anywhere */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const signOut = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* session may already be gone */
    }
    router.replace('/login');
  };

  useClickOutside(userChipRef, () => setUserMenu(false), userMenu);

  if (user === undefined || user === null) {
    return (
      <div className="content" role="status" aria-live="polite">
        <div className="flex" style={{ marginBottom: 20 }}>
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 20 }}>M</div>
          <div>
            <div style={{ fontWeight: 700 }}>MediCore HIS</div>
            <div className="t-sub">Checking your session…</div>
          </div>
        </div>
        <PageSkeleton kpis={4} tables={1} />
      </div>
    );
  }

  const nav = NAV.map((group) => ({
    ...group,
    items: group.items.filter((it) => it.roles === '*' || it.roles.includes(user.role)),
  })).filter((g) => g.items.length);

  return (
    <AppContext.Provider value={{ user, setUser, signOut, openPalette: () => setPaletteOpen(true) }}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <div className="app">
        {open ? <div className="sidebar-scrim" onClick={() => setOpen(false)} /> : null}
        <aside className={`sidebar ${open ? 'open' : ''} ${rail ? 'rail' : ''}`.trim()}>
          <div className="brand">
            <div className="brand-mark">M</div>
            <div className="brand-text">
              <div className="brand-name">MediCore HIS</div>
              <div className="brand-sub">Healthcare Information</div>
            </div>
          </div>

          <nav className="nav" aria-label="Main navigation">
            {nav.map((group) => (
              <div key={group.label}>
                <div className="nav-group-label">{group.label}</div>
                <div className="nav-list">
                  {group.items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`nav-item ${active ? 'active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        title={rail ? item.text : undefined}
                      >
                        <Icon name={NAV_ICONS[item.key]} className="ico" size={19} />
                        <span className="txt">{item.text}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="sidebar-foot">
            <div className="foot-role">{ROLE_LABELS[user.role] || user.role}</div>
            <div className="foot-email" title={user.email}>
              {user.email}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, opacity: 0.75 }}>🔒 Encrypted session · v1.0</div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <div className="topbar-left">
              <button className="hamburger" onClick={() => setOpen((o) => !o)} aria-label="Toggle navigation" aria-expanded={open}>
                ☰
              </button>
              <button
                className="rail-toggle"
                onClick={toggleRail}
                aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
                title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <Icon name="panel" size={17} />
              </button>
              <div className="tb-title">
                <h1>{title}</h1>
                {crumb ? <div className="crumb">{crumb}</div> : null}
              </div>
            </div>

            <button
              className="search-trigger"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search or run a command"
              type="button"
            >
              <Icon name="search" size={15} />
              <span className="st-txt">Search or jump to…</span>
              <span className="kbd">{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl'} K</span>
            </button>

            <div className="topbar-right">
              <button
                className="icon-btn"
                onClick={theme.toggle}
                aria-label={theme.effective === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={theme.effective === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                type="button"
              >
                <Icon name={theme.effective === 'dark' ? 'sun' : 'moon'} size={16} />
              </button>

              <div className="menu-wrap" ref={userChipRef}>
                <button
                  className="user-chip"
                  onClick={() => setUserMenu((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={userMenu}
                  type="button"
                >
                  <div className="avatar">{initials(user.name)}</div>
                  <div className="u-meta">
                    <div className="u-name">{user.name}</div>
                    <div className="u-role">{ROLE_LABELS[user.role] || user.role}</div>
                  </div>
                  <Icon name="chevronDown" size={14} />
                </button>
                {userMenu ? (
                  <div className="menu right" role="menu" aria-label="Account menu">
                    <div className="menu-label" style={{ display: 'flex', gap: 10, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
                      <div className="avatar">{initials(user.name)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--ink)' }}>{user.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
                      </div>
                    </div>
                    <div className="menu-sep" />
                    <Link href="/dashboard" className="menu-item" role="menuitem" onClick={() => setUserMenu(false)}>
                      <Icon name="grid" size={16} /> Dashboard
                    </Link>
                    <button
                      className="menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setUserMenu(false);
                        theme.toggle();
                      }}
                    >
                      <Icon name={theme.effective === 'dark' ? 'sun' : 'moon'} size={16} />
                      {theme.effective === 'dark' ? 'Light appearance' : 'Dark appearance'}
                    </button>
                    <div className="menu-sep" />
                    <button className="menu-item danger" role="menuitem" type="button" onClick={signOut}>
                      <Icon name="logout" size={16} /> Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <main className="content" id="main-content">
            <div className="page-enter" key={pathname}>
              {children}
            </div>
          </main>
        </div>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} user={user} />
        <Toaster />
      </div>
    </AppContext.Provider>
  );
}
