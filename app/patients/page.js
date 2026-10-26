'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import AppShell, { useApp } from '@/components/AppShell.js';
import { PageHead, EmptyState, Loading, Modal, Field } from '@/components/ui.js';
import { DataTable, Toolbar, SearchInput, FilterSelect } from '@/components/Table.js';
import { api, toast, toastError, fmtDate, statusLabel, STATUS_BADGE, initials, can } from '@/lib/client.js';

const GENDERS = ['Male', 'Female', 'Other'];

/* ------------------------------ list page -------------------------------- */

function PatientsContent() {
  const { user } = useApp();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [registerOpen, setRegisterOpen] = useState(false);

  const mayWrite = can(user, 'patient:create');

  const load = useCallback(() => {
    setError('');
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status !== 'all') params.set('status', status);
    api(`/api/patients?${params}`)
      .then((d) => setRows(d.patients || []))
      .catch((e) => setError(e.message));
  }, [search, status]);

  useEffect(() => {
    const t = setTimeout(load, 180); // light debounce while typing
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1' && mayWrite) setRegisterOpen(true);
  }, [mayWrite]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!rows) return <Loading label="Loading patients…" />;

  return (
    <>
      <PageHead title="Patients" sub={`${rows.length} record${rows.length === 1 ? '' : 's'} · registry and demographics`}>
        {mayWrite ? (
          <Link href="/patients?new=1" className="btn btn-primary" onClick={(e) => { e.preventDefault(); setRegisterOpen(true); }}>
            ＋ Register patient
          </Link>
        ) : null}
      </PageHead>

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, code, phone or email…" />
        <FilterSelect
          value={status}
          onChange={setStatus}
          label="Status filter"
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />
      </Toolbar>

      <DataTable
        columns={[
          { key: 'patient_code', label: 'Code', cls: 'mono' },
          {
            key: 'name',
            label: 'Patient',
            render: (p) => (
              <div>
                <div className="t-strong">{p.name}</div>
                <div className="t-sub">
                  {p.gender || '—'}{p.age !== null && p.age !== undefined ? ` · ${p.age} yrs` : ''}
                  {p.allergies && p.allergies !== 'None' ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}> · ⚠ {p.allergies}</span> : null}
                </div>
              </div>
            ),
          },
          { key: 'phone', label: 'Phone', cls: 'nowrap' },
          { key: 'blood_group', label: 'Blood', render: (p) => p.blood_group || '—' },
          { key: 'last_visit', label: 'Last visit', cls: 'nowrap', render: (p) => (p.last_visit ? fmtDate(p.last_visit) : '—') },
          { key: 'upcoming', label: 'Upcoming', cls: 'num', render: (p) => p.upcoming || 0 },
          { key: 'status', label: 'Status', render: (p) => <span className={`badge ${STATUS_BADGE[p.status] || 'badge-muted'}`}>{statusLabel(p.status)}</span> },
          {
            key: '_actions',
            label: '',
            align: 'right',
            render: (p) => (
              <Link href={`/patients/${p.id}`} className="btn btn-soft btn-sm">Open →</Link>
            ),
          },
        ]}
        rows={rows}
        keyFn={(p) => p.id}
        pageSize={25}
        rowLabel="patient"
        empty={
          <EmptyState
            icon="👥"
            title="No patients found"
            sub={search || status !== 'all' ? 'Try a different search or filter.' : 'Register your first patient to get started.'}
            action={mayWrite ? <button className="btn btn-primary btn-sm" onClick={() => setRegisterOpen(true)}>Register patient</button> : null}
          />
        }
      />

      {registerOpen ? (
        <RegisterModal onClose={() => setRegisterOpen(false)} onSaved={() => { setRegisterOpen(false); load(); }} />
      ) : null}
    </>
  );
}

export default function PatientsPage() {
  return (
    <AppShell title="Patients" crumb="Clinical · patient registry">
      <PatientsContent />
    </AppShell>
  );
}

/* ---------------------------- register modal ----------------------------- */

function RegisterModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', dob: '', gender: 'Male', phone: '', email: '', address: '',
    blood_group: '', allergies: '', emergency_contact: '', notes: '',
  });
  const [createLogin, setCreateLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { ...form, createLogin, password: createLogin ? password : undefined };
      const d = await api('/api/patients', { method: 'POST', body });
      toast(`Registered ${d.patient.name} (${d.patient.patient_code})`, 'success');
      if (d.account) toast(`Portal login created: ${d.account.email}`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Register patient" sub="Create a new patient record (FR-04)" onClose={onClose} size="wide"
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Register patient'}</button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <div className="form-row">
        <Field label="Full name" required>
          <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Meera Iyer" autoFocus />
        </Field>
        <Field label="Date of birth" hint="Used to compute age automatically">
          <input className="input" type="date" value={form.dob} onChange={set('dob')} max={new Date().toISOString().slice(0, 10)} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Gender">
          <select className="select" value={form.gender} onChange={set('gender')}>
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Blood group">
          <input className="input" value={form.blood_group} onChange={set('blood_group')} placeholder="e.g. O+" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Phone" hint="Digits, +, - and spaces allowed">
          <input className="input" value={form.phone} onChange={set('phone')} placeholder="98765 43210" />
        </Field>
        <Field label="Email" hint="Optional · used for the patient portal login">
          <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="name@example.com" />
        </Field>
      </div>
      <Field label="Address">
        <input className="input" value={form.address} onChange={set('address')} />
      </Field>
      <div className="form-row">
        <Field label="Known allergies" hint="Shown as a warning on every screen">
          <input className="input" value={form.allergies} onChange={set('allergies')} placeholder="e.g. Penicillin" />
        </Field>
        <Field label="Emergency contact">
          <input className="input" value={form.emergency_contact} onChange={set('emergency_contact')} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className="textarea" value={form.notes} onChange={set('notes')} />
      </Field>

      <label className="check mt-8">
        <input type="checkbox" checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} />
        Create a patient portal login (email + password)
      </label>
      {createLogin ? (
        <div className="form-row mt-8">
          <Field label="Login password" required hint="Minimum 6 characters">
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}
