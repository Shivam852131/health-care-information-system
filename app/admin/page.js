'use client';

import { useCallback, useEffect, useState } from 'react';
import AppShell, { useApp } from '@/components/AppShell.js';
import { PageHead, EmptyState, Loading, Modal, Field } from '@/components/ui.js';
import { DataTable, Toolbar, SearchInput, FilterSelect } from '@/components/Table.js';
import { PatientSelect, DoctorSelect } from '@/components/pickers.js';
import { api, toast, toastError, fmtDateTime, fmtDate, statusLabel, STATUS_BADGE, ROLE_LABELS, initials, timeAgo } from '@/lib/client.js';

const ROLES = ['admin', 'doctor', 'receptionist', 'lab', 'patient'];
const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'audit', label: 'Audit log' },
  { key: 'settings', label: 'Settings' },
];

function AdminContent() {
  const { user } = useApp();
  const [tab, setTab] = useState('users');
  // audit log should only ever render for admins; AppShell nav already hides it,
  // and every underlying API route re-checks server-side.
  if (user.role !== 'admin') {
    return <div className="alert alert-danger">You do not have permission to access administration.</div>;
  }
  return (
    <>
      <PageHead title="Administration" sub="User accounts, audit trail and hospital settings (FR-08)" />
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'users' ? <UsersTab /> : null}
      {tab === 'audit' ? <AuditTab /> : null}
      {tab === 'settings' ? <SettingsTab /> : null}
    </>
  );
}

export default function AdminPage() {
  return (
    <AppShell title="Administration" crumb="System · users, audit and settings">
      <AdminContent />
    </AppShell>
  );
}

/* -------------------------------- users ---------------------------------- */

function UsersTab() {
  const { user } = useApp();
  const [rows, setRows] = useState(null);
  const [selfId, setSelfId] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setError('');
    api('/api/admin/users')
      .then((d) => { setRows(d.users || []); setSelfId(d.selfId); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleStatus = async (u) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: { status: u.status === 'active' ? 'inactive' : 'active' } });
      toast(`${u.email} is now ${u.status === 'active' ? 'inactive' : 'active'}`, 'success');
      load();
    } catch (e) {
      toastError(e);
    }
  };

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!rows) return <Loading label="Loading users…" />;

  const term = q.trim().toLowerCase();
  const filtered = rows.filter((u) => {
    if (role !== 'all' && u.role !== role) return false;
    if (!term) return true;
    return u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term);
  });

  return (
    <>
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search name or email…" />
        <FilterSelect value={role} onChange={setRole} label="Role"
          options={[{ value: 'all', label: 'All roles' }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))]} />
        <div className="right-gap">
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>＋ Add user</button>
        </div>
      </Toolbar>

      <DataTable
        columns={[
          {
            key: 'name',
            label: 'User',
            render: (u) => (
              <div className="flex">
                <div className="avatar">{initials(u.name)}</div>
                <div>
                  <div className="t-strong">{u.name}{u.id === selfId ? <span className="t-sub"> (you)</span> : null}</div>
                  <div className="t-sub">{u.email}</div>
                </div>
              </div>
            ),
          },
          { key: 'role', label: 'Role', render: (u) => <span className="pill">{ROLE_LABELS[u.role] || u.role}</span> },
          {
            key: 'link',
            label: 'Linked record',
            render: (u) => (u.patient_code ? <span className="mono">{u.patient_code}</span>
              : u.doctor_code ? <span className="mono">{u.doctor_code} · {u.specialization}</span> : '—'),
          },
          { key: 'last_login', label: 'Last login', render: (u) => (u.last_login ? timeAgo(u.last_login) : 'never') },
          { key: 'status', label: 'Status', render: (u) => <span className={`badge ${STATUS_BADGE[u.status] || 'badge-muted'}`}>{statusLabel(u.status)}</span> },
          {
            key: '_actions',
            label: '',
            align: 'right',
            render: (u) => (
              <div className="flex" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>Edit</button>
                {u.id !== selfId ? (
                  <button className={`btn btn-sm ${u.status === 'active' ? 'btn-danger' : 'btn-soft'}`} onClick={() => toggleStatus(u)}>
                    {u.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={filtered}
        keyFn={(u) => u.id}
        pageSize={20}
        rowLabel="user"
        empty={<EmptyState icon="👤" title="No users found" sub={q || role !== 'all' ? 'Try different filters.' : 'Add the first account.'} />}
      />

      {addOpen ? <AddUserModal onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} /> : null}
      {editing ? <EditUserModal target={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </>
  );
}

function AddUserModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'receptionist', password: '' });
  const [patientId, setPatientId] = useState(null);
  const [doctorId, setDoctorId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { ...form, patientId: form.role === 'patient' ? patientId : null, doctorId: form.role === 'doctor' ? doctorId : null };
      const d = await api('/api/admin/users', { method: 'POST', body });
      toast(`Created account for ${d.user.name} (${d.user.email})`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add user" sub="Staff or patient portal account" onClose={onClose} onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create user'}</button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <div className="form-row">
        <Field label="Full name" required><input className="input" value={form.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Email" required hint="Used to sign in"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
      </div>
      <div className="form-row">
        <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Role" required>
          <select className="select" value={form.role} onChange={set('role')}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
      </div>
      {form.role === 'patient' ? <PatientSelect value={patientId} onChange={setPatientId} required label="Link to patient record" /> : null}
      {form.role === 'doctor' ? <DoctorSelect value={doctorId} onChange={setDoctorId} required label="Link to doctor profile" includeInactive /> : null}
      <Field label="Password" required hint="Minimum 6 characters">
        <input className="input" type="password" value={form.password} onChange={set('password')} />
      </Field>
    </Modal>
  );
}

function EditUserModal({ target: u, onClose, onSaved }) {
  const [form, setForm] = useState({ name: u.name, phone: u.phone || '', role: u.role, status: u.status, password: '' });
  const [patientId, setPatientId] = useState(u.linked_patient_id || null);
  const [doctorId, setDoctorId] = useState(u.linked_doctor_id || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { name: form.name, phone: form.phone, role: form.role, status: form.status };
      if (form.password) body.password = form.password;
      if (form.role === 'patient') body.patientId = patientId;
      if (form.role === 'doctor') body.doctorId = doctorId;
      await api(`/api/admin/users/${u.id}`, { method: 'PUT', body });
      toast(`Updated ${u.email}`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit user" sub={u.email} onClose={onClose} onSubmit={submit} size="wide"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <div className="form-row">
        <Field label="Name" required><input className="input" value={form.name} onChange={set('name')} /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
      </div>
      <div className="form-row">
        <Field label="Role" required>
          <select className="select" value={form.role} onChange={set('role')}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        <Field label="Status" required>
          <select className="select" value={form.status} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      </div>
      {form.role === 'patient' ? <PatientSelect value={patientId} onChange={setPatientId} required label="Linked patient record" /> : null}
      {form.role === 'doctor' ? <DoctorSelect value={doctorId} onChange={setDoctorId} required label="Linked doctor profile" includeInactive /> : null}
      <Field label="Reset password" hint="Leave empty to keep the current password">
        <input className="input" type="password" value={form.password} onChange={set('password')} />
      </Field>
    </Modal>
  );
}

/* ------------------------------- audit log ------------------------------- */

function AuditTab() {
  const [rows, setRows] = useState(null);
  const [actions, setActions] = useState([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [action, setAction] = useState('all');

  const load = useCallback(() => {
    setError('');
    const params = new URLSearchParams({ limit: '200' });
    if (q) params.set('q', q);
    if (role !== 'all') params.set('role', role);
    if (action !== 'all') params.set('action', action);
    api(`/api/admin/audit?${params}`)
      .then((d) => { setRows(d.logs || []); setActions(d.actions || []); })
      .catch((e) => setError(e.message));
  }, [q, role, action]);

  useEffect(() => {
    const t = setTimeout(load, 180);
    return () => clearTimeout(t);
  }, [load]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!rows) return <Loading label="Loading audit trail…" />;

  return (
    <>
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search user, action or detail…" />
        <FilterSelect value={role} onChange={setRole} label="Role"
          options={[{ value: 'all', label: 'All roles' }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))]} />
        <FilterSelect value={action} onChange={setAction} label="Action"
          options={[{ value: 'all', label: 'All actions' }, ...actions.map((a) => ({ value: a, label: a.replace(/[._]/g, ' ') }))]} />
      </Toolbar>

      <DataTable
        columns={[
          { key: 'created_at', label: 'When', cls: 'nowrap', render: (l) => <span className="t-sub">{fmtDateTime(l.created_at)}</span> },
          {
            key: 'user_name',
            label: 'Actor',
            render: (l) => (
              <div>
                <div className="t-strong">{l.user_name || 'System'}</div>
                <div className="t-sub">{ROLE_LABELS[l.user_role] || l.user_role || ''}</div>
              </div>
            ),
          },
          { key: 'action', label: 'Action', render: (l) => <span className="pill mono">{l.action}</span> },
          { key: 'entity', label: 'Entity', render: (l) => <span className="t-sub">{l.entity}{l.entity_id ? ` #${l.entity_id}` : ''}</span> },
          { key: 'detail', label: 'Detail', render: (l) => l.detail || '—' },
        ]}
        rows={rows}
        keyFn={(l) => l.id}
        pageSize={25}
        rowLabel="audit entry"
        empty={<EmptyState icon="📜" title="No audit entries" sub="Important actions are recorded here automatically." />}
      />
      <p className="inline-note mt-14">Showing the latest {rows.length} entries · every create, update, upload and download is recorded (FR-08).</p>
    </>
  );
}

/* ------------------------------- settings -------------------------------- */

function SettingsTab() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api('/api/admin/settings')
      .then((d) => { setSettings(d.settings); setForm({ ...d.settings }); })
      .catch((e) => setError(e.message));
  }, []);

  const set = (k) => (e) => { setSaved(false); setForm({ ...form, [k]: e.target.value }); };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const d = await api('/api/admin/settings', { method: 'PUT', body: form });
      setSettings(d.settings);
      setForm({ ...d.settings });
      setSaved(true);
      toast('Settings saved', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !form) return <div className="alert alert-danger">{error}</div>;
  if (!form) return <Loading label="Loading settings…" />;

  return (
    <div className="grid grid-2 mt-14">
      <div className="card">
        <div className="card-head"><div><h3>Hospital profile</h3><div className="sub">Shown on printed invoices and sheets</div></div></div>
        <form className="card-body" onSubmit={submit}>
          {error ? <div className="alert alert-danger">{error}</div> : null}
          {saved ? <div className="alert alert-success">Settings saved ✓</div> : null}
          <Field label="Hospital name" required><input className="input" value={form.hospital_name || ''} onChange={set('hospital_name')} /></Field>
          <Field label="Address"><input className="input" value={form.hospital_address || ''} onChange={set('hospital_address')} /></Field>
          <div className="form-row">
            <Field label="Phone"><input className="input" value={form.hospital_phone || ''} onChange={set('hospital_phone')} /></Field>
            <Field label="Email"><input className="input" type="email" value={form.hospital_email || ''} onChange={set('hospital_email')} /></Field>
          </div>
          <Field label="Currency symbol" hint="Max 6 characters, shown on all money values">
            <input className="input" value={form.currency || ''} onChange={set('currency')} />
          </Field>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        </form>
      </div>

      <div className="card">
        <div className="card-head"><div><h3>Appointment rules</h3><div className="sub">Applies to all bookings and reschedules</div></div></div>
        <form className="card-body" onSubmit={submit}>
          <Field label="Slot length (minutes)" hint="5 – 240; slot grids are rebuilt from this">
            <input className="input" type="number" min="5" max="240" value={form.appointment_slot_minutes || '30'} onChange={set('appointment_slot_minutes')} />
          </Field>
          <Field label="Booking horizon (days)" hint="How far ahead patients may book (1 – 365)">
            <input className="input" type="number" min="1" max="365" value={form.appointment_horizon_days || '30'} onChange={set('appointment_horizon_days')} />
          </Field>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        </form>
      </div>
    </div>
  );
}
