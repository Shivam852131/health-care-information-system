'use client';

import { useEffect, useRef, useState } from 'react';

/* --------------------------------- Modal --------------------------------- */

export function Modal({ title, sub, onClose, children, footer, onSubmit, size, formId }) {
  const cardRef = useRef(null);
  const openerRef = useRef(null);

  /* Remember what had focus so we can hand it back on close (a11y). */
  useEffect(() => {
    openerRef.current = document.activeElement;
    const first = cardRef.current?.querySelector?.(
      'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)'
    );
    if (first) first.focus();
    else cardRef.current?.focus?.();
    return () => {
      const el = openerRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      /* simple focus trap: keep Tab inside the dialog */
      if (e.key !== 'Tab' || !cardRef.current) return;
      const focusables = cardRef.current.querySelectorAll(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const cls = `modal ${size === 'wide' ? 'wide' : size === 'narrow' ? 'narrow' : ''}`.trim();

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cls} role="dialog" aria-modal="true" aria-label={title} ref={cardRef} tabIndex={-1}>
        <div className="modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3>{title}</h3>
            {sub ? <div className="sub">{sub}</div> : null}
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        {onSubmit ? (
          <form
            id={formId}
            onSubmit={onSubmit}
            noValidate
            style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
          >
            <div className="modal-body">{children}</div>
            {footer ? <div className="modal-foot">{footer}</div> : null}
          </form>
        ) : (
          <>
            <div className="modal-body">{children}</div>
            {footer ? <div className="modal-foot">{footer}</div> : null}
          </>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- Field --------------------------------- */

export function Field({ label, required, hint, error, children, id }) {
  return (
    <div className="field">
      {label ? (
        <label className="label" htmlFor={id}>
          {label}
          {required ? <span className="req">*</span> : null}
        </label>
      ) : null}
      {children}
      {hint && !error ? <div className="hint">{hint}</div> : null}
      {error ? <div className="err-text" role="alert">{error}</div> : null}
    </div>
  );
}

/* ------------------------------- Empty state ----------------------------- */

export function EmptyState({ icon = '📭', title = 'Nothing here yet', sub, action }) {
  return (
    <div className="empty">
      <div className="e-ico">{icon}</div>
      <div className="e-title">{title}</div>
      {sub ? <div className="e-sub">{sub}</div> : null}
      {action ? <div className="mt-14">{action}</div> : null}
    </div>
  );
}

/* ------------------------------- Skeletons ------------------------------- */

/** Generic shimmer block — width/height via style or a preset class. */
export function Skeleton({ className = '', style }) {
  return <div className={`sk ${className}`.trim()} style={style} aria-hidden="true" />;
}

/** Page-shaped loading placeholder that mirrors KPI + content layout. */
export function PageSkeleton({ kpis = 4, tables = 2 }) {
  return (
    <div aria-hidden="true">
      <div className="flex" style={{ marginBottom: 18 }}>
        <Skeleton className="sk-title" />
        <div className="right-gap" style={{ display: 'flex', gap: 9 }}>
          <Skeleton style={{ width: 128, height: 36, borderRadius: 10 }} />
          <Skeleton style={{ width: 128, height: 36, borderRadius: 10 }} />
        </div>
      </div>
      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        {Array.from({ length: kpis }, (_, i) => (
          <Skeleton key={i} className="sk-kpi" />
        ))}
      </div>
      {Array.from({ length: tables }, (_, i) => (
        <Skeleton key={i} className="sk-card" style={{ marginBottom: 16 }} />
      ))}
    </div>
  );
}

/** Inline row placeholder (spinner replacement inside cards/lists). */
export function InlineSkeleton({ rows = 3 }) {
  return (
    <div aria-hidden="true" style={{ padding: '10px 0' }}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i}>
          <Skeleton style={{ width: 34, height: 34, borderRadius: 10, flex: '0 0 auto' }} />
          <div style={{ flex: 1 }}>
            <Skeleton className="sk-line" style={{ width: `${58 - i * 7}%`, marginBottom: 7 }} />
            <Skeleton className="sk-line" style={{ width: `${34 - i * 4}%`, height: 9 }} />
          </div>
          <Skeleton style={{ width: 64, height: 22, borderRadius: 99, flex: '0 0 auto' }} />
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- Loading -------------------------------- */

export function Loading({ label = 'Loading…', variant = 'page' }) {
  if (variant === 'inline') return <InlineSkeleton rows={3} />;
  return (
    <>
      <PageSkeleton />
      <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {label}
      </span>
    </>
  );
}

export function InlineRow({ label = 'Loading…' }) {
  return (
    <div className="flex" style={{ padding: '18px 4px', color: 'var(--ink-3)', fontSize: 13.5 }} role="status">
      <div className="spinner sm" />
      <span>{label}</span>
    </div>
  );
}

/* --------------------------------- Toaster -------------------------------- */

const TOAST_ICONS = { success: '✓', error: '✕', warning: '!', info: 'i' };
const TOAST_DURATION = { success: 3600, info: 4300, warning: 5200, error: 6500 };

export function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const dismiss = (id) => setItems((prev) => prev.filter((x) => x.id !== id));
    const onToast = (e) => {
      const t = e.detail;
      setItems((prev) => [...prev.slice(-3), t]);
      setTimeout(() => dismiss(t.id), TOAST_DURATION[t.type] || TOAST_DURATION.info);
    };
    window.addEventListener('his-toast', onToast);
    return () => window.removeEventListener('his-toast', onToast);
  }, []);

  return (
    <div className="toast-wrap" aria-live="polite" aria-atomic="false">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.type || 'info'}`}>
          <span className="t-ico">{TOAST_ICONS[t.type] || 'i'}</span>
          <span className="t-msg">{t.message}</span>
          <button
            type="button"
            className="t-x"
            aria-label="Dismiss notification"
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
          >
            ✕
          </button>
          <span className="t-timer" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Page helpers ----------------------------- */

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div className="grow">
        <h2>{title}</h2>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, right }) {
  return (
    <div className="section-title">
      <h3>{children}</h3>
      <div className="line" />
      {right}
    </div>
  );
}
