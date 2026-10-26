'use client';

/* --------------------------- API access helper --------------------------- */

export async function api(path, options = {}) {
  const { body, formData, method, ...rest } = options;
  const init = {
    method: method || (body !== undefined || formData ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: {},
    ...rest,
  };
  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(path, init);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status}).`);
    err.status = res.status;
    err.data = data;
    // Session expired on a non-auth endpoint → force a fresh sign-in.
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      setTimeout(() => {
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.assign('/login');
        }
      }, 0);
    }
    throw err;
  }
  return data;
}

/* --------------------------------- toasts -------------------------------- */

export function toast(message, type = 'info') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('his-toast', { detail: { id: Math.random(), message: String(message || ''), type } })
  );
}

export function toastError(err, fallback = 'Something went wrong.') {
  toast(err?.message || fallback, 'error');
}

/* ------------------------------- formatters ------------------------------ */

let currencySymbol = '₹';
export function setCurrency(symbol) {
  if (symbol) currencySymbol = symbol;
}
export function getCurrency() {
  return currencySymbol;
}

export function fmtMoney(n, withSymbol = true) {
  const v = Number(n || 0);
  const s = v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return withSymbol ? `${currencySymbol}${s}` : s;
}

export function fmtDate(value) {
  if (!value) return '—';
  const str = String(value);
  const d = new Date(str.length === 10 ? `${str}T00:00:00` : str.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtShortDate(value) {
  if (!value) return '—';
  const str = String(value);
  const d = new Date(str.length === 10 ? `${str}T00:00:00` : str.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function fmtTime(value) {
  if (!value) return '—';
  const str = String(value).slice(0, 5);
  const [h, m] = str.split(':').map(Number);
  if (Number.isNaN(h)) return str;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const str = String(value);
  const d = new Date(str.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return str;
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · ${d
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()}`;
}

export function timeAgo(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(value);
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`;
  const days = Math.floor(secs / 86400);
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
  return fmtDate(value);
}

export function ageFromDob(dob) {
  if (!dob) return null;
  const birth = new Date(`${String(dob).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

/** Doctor display name: ensures exactly one "Dr." prefix. */
export function drName(name) {
  const clean = String(name || '').trim();
  if (!clean) return '—';
  return /^dr\.?\s+/i.test(clean) ? clean : `Dr. ${clean}`;
}

export function initials(name) {
  const parts = String(name || '?')
    .replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export const todayISO = () => {
  const x = new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export function relDate(offset = 0) {
  const x = new Date();
  x.setDate(x.getDate() + offset);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/* --------------------------- display maps -------------------------------- */

export const STATUS_BADGE = {
  scheduled: 'badge-info',
  completed: 'badge-success',
  cancelled: 'badge-danger',
  no_show: 'badge-warning',
  pending: 'badge-warning',
  partial: 'badge-info',
  paid: 'badge-success',
  requested: 'badge-warning',
  in_progress: 'badge-info',
  active: 'badge-success',
  inactive: 'badge-muted',
  lab: 'badge-violet',
};

export const STATUS_LABEL = {
  no_show: 'No-show',
  in_progress: 'In progress',
};

export const ROLE_LABELS = {
  admin: 'Administrator',
  doctor: 'Doctor',
  patient: 'Patient',
  lab: 'Laboratory Staff',
  receptionist: 'Receptionist',
};

export function statusLabel(status) {
  return STATUS_LABEL[status] || String(status || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export const can = (user, action) => {
  const role = user?.role;
  const matrix = {
    'patient:create': ['admin', 'receptionist'],
    'patient:update': ['admin', 'receptionist'],
    'appointment:book': ['admin', 'receptionist', 'patient'],
    'appointment:manage': ['admin', 'receptionist'],
    'appointment:complete': ['admin', 'doctor'],
    'record:create': ['admin', 'doctor'],
    'record:update': ['admin', 'doctor'],
    'lab:order': ['admin', 'doctor', 'receptionist'],
    'lab:result': ['admin', 'lab'],
    'rx:create': ['admin', 'doctor'],
    'invoice:create': ['admin', 'receptionist'],
    'payment:record': ['admin', 'receptionist'],
    'report:view': ['admin', 'doctor', 'receptionist'],
    'admin:manage': ['admin'],
    'doctor:create': ['admin'],
  };
  return (matrix[action] || []).includes(role);
};
