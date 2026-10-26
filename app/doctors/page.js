'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell, { useApp } from '@/components/AppShell.js';
import { PageHead, EmptyState, Loading, Modal, Field } from '@/components/ui.js';
import { Toolbar, SearchInput } from '@/components/Table.js';
import { api, toast, toastError, fmtMoney, fmtDate, fmtTime, statusLabel, STATUS_BADGE, initials, can, drName } from '@/lib/client.js';
import { availabilitySummary } from '@/components/pickers.js';

const DAYS = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];

function DoctorsContent() {
  const { user } = useApp();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // doctor being edited (schedule or profile)
  const [detail, setDetail] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  const mayAdd = can(user, 'doctor:create'); // admin only

  const load = useCallback(() => {
    setError('');
    api('/api/doctors').then((d) => setRows(d.doctors || [])).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!rows) return <Loading label="Loading doctors…" />;

  const term = q.trim().toLowerCase();
  const filtered = term
    ? rows.filter((d) => d.name.toLowerCase().includes(term) || d.specialization.toLowerCase().includes(term))
    : rows;

  return (
    <>
      <PageHead title="Doctors" sub={`${rows.filter((d) => d.status === 'active').length} active specialists · schedules and fees`}>
        {mayAdd ? (
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>＋ Add doctor</button>
        ) : null}
      </PageHead>

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search name or specialization…" />
      </Toolbar>

      {filtered.length === 0 ? (
        <EmptyState icon="🩺" title="No doctors found" sub={q ? 'Try a different search.' : 'Add the first doctor.'} />
      ) : (
        <div className="grid grid-3">
          {filtered.map((d) => (
            <div className="card" key={d.id}>
              <div className="card-head">
                <div className="flex">
                  <div className="avatar">{initials(d.name)}</div>
                  <div>
                    <h3>{drName(d.name)}</h3>
                    <div className="sub">{d.specialization}{d.qualification ? ` · ${d.qualification}` : ''}</div>
                  </div>
                </div>
                <div className="right">
                  <span className={`badge ${STATUS_BADGE[d.status] || 'badge-muted'}`}>{statusLabel(d.status)}</span>
                </div>
              </div>
              <div className="card-body">
                <div className="kv"><span className="k">Consult fee</span><span className="v">{fmtMoney(d.fee)}</span></div>
                <div className="kv"><span className="k">Today</span><span className="v">{d.today_count} scheduled</span></div>
                <div className="kv"><span className="k">Upcoming</span><span className="v">{d.upcoming_count}</span></div>
                <div className="kv"><span className="k">Patients seen</span><span className="v">{d.patient_count}</span></div>
                <div className="kv"><span className="k">Hours</span><span className="v" style={{ fontSize: 12.5 }}>{availabilitySummary(d.availability)}</span></div>
                {d.login_email ? (
                  <div className="kv"><span className="k">Login</span><span className="v t-sub">{d.login_email}</span></div>
                ) : null}
                <div className="flex mt-14">
                  <button className="btn btn-ghost btn-sm" onClick={() => setDetail(d)}>Profile</button>
                  {d.canEdit ? (
                    <button className="btn btn-soft btn-sm" onClick={() => setEditing(d)}>Edit schedule</button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? <ScheduleModal doctor={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
      {detail ? (
        <ProfileModal doctor={detail} onClose={() => setDetail(null)}
          onEdit={() => { const d = detail; setDetail(null); if (d.canEdit) setEditing(d); }} />
      ) : null}
      {addOpen ? <AddModal onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} /> : null}
    </>
  );
}

export default function DoctorsPage() {
  return (
    <AppShell title="Doctors" crumb="Clinical · specialists and working hours">
      <DoctorsContent />
    </AppShell>
  );
}

/* ------------------------------ profile modal ---------------------------- */

function ProfileModal({ doctor: d, onClose, onEdit }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    api(`/api/doctors/${d.id}`).then(setInfo).catch(() => setInfo({ doctor: d, stats: null, upcoming: [], permissions: {} }));
  }, [d.id]);
  const doc = info?.doctor || d;
  return (
    <Modal title={drName(doc.name)} sub={`${doc.specialization}${doc.qualification ? ` · ${doc.qualification}` : ''}`} onClose={onClose} size="wide"
      footer={
        <>
          {info?.permissions?.canEdit ? (
            <button type="button" className="btn btn-soft" onClick={onEdit}>Edit schedule</button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
        </>
      }>
      <div className="kv"><span className="k">Code</span><span className="v mono">{doc.doctor_code}</span></div>
      <div className="kv"><span className="k">Fee</span><span className="v">{fmtMoney(doc.fee)}</span></div>
      <div className="kv"><span className="k">Phone</span><span className="v">{doc.phone || '—'}</span></div>
      <div className="kv"><span className="k">Email</span><span className="v">{doc.email || '—'}</span></div>
      <div className="kv"><span className="k">Hours</span><span className="v">{availabilitySummary(doc.availability)}</span></div>
      {info?.stats ? (
        <div className="flex mt-14">
          <span className="pill">{info.stats.today_count} today</span>
          <span className="pill">{info.stats.upcoming_count} upcoming</span>
          <span className="pill">{info.stats.completed_count} completed</span>
          <span className="pill">{info.stats.patient_count} patients</span>
        </div>
      ) : null}
      {info?.upcoming?.length ? (
        <>
          <div className="label mt-20">Next appointments</div>
          <div className="list">
            {info.upcoming.map((a) => (
              <div className="list-row" key={a.id}>
                <div className="time-chip">{fmtTime(a.time)}</div>
                <div className="grow">
                  <div className="r-title">{a.patient_name}</div>
                  <div className="r-sub">{fmtDate(a.date)} · {a.reason}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Modal>
  );
}

/* ----------------------------- schedule modal ---------------------------- */

function ScheduleModal({ doctor: d, onClose, onSaved }) {
  const [avail, setAvail] = useState(() => {
    const out = {};
    for (const [k] of DAYS) out[k] = d.availability?.[k] ? [...d.availability[k]] : null;
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (day) => setAvail({ ...avail, [day]: avail[day] ? null : ['09:00', '17:00'] });
  const setTime = (day, idx, v) => {
    const next = [...(avail[day] || ['09:00', '17:00'])];
    next[idx] = v;
    setAvail({ ...avail, [day]: next });
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api(`/api/doctors/${d.id}`, { method: 'PUT', body: { availability: avail } });
      toast(`Schedule updated for ${drName(d.name)}`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Schedule — ${drName(d.name)}`} sub="Patients can only book inside these hours" onClose={onClose} onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save schedule'}</button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      {DAYS.map(([k, label]) => (
        <div className="flex" key={k} style={{ marginBottom: 8 }}>
          <label className="check" style={{ minWidth: 130 }}>
            <input type="checkbox" checked={!!avail[k]} onChange={() => toggle(k)} />
            {label}
          </label>
          {avail[k] ? (
            <div className="flex">
              <input className="input" type="time" step="300" value={avail[k][0]} onChange={(e) => setTime(k, 0, e.target.value)} aria-label={`${label} start`} />
              <span className="dim">to</span>
              <input className="input" type="time" step="300" value={avail[k][1]} onChange={(e) => setTime(k, 1, e.target.value)} aria-label={`${label} end`} />
            </div>
          ) : (
            <span className="inline-note">Not consulting</span>
          )}
        </div>
      ))}
      <p className="inline-note mt-14">At least one working day is required. Changes are written to the audit log.</p>
    </Modal>
  );
}

/* ------------------------------- add modal ------------------------------- */

function AddModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', specialization: '', qualification: '', phone: '', email: '', fee: '',
    password: '',
  });
  const [avail, setAvail] = useState(() => {
    const out = {};
    for (const [k] of DAYS) out[k] = ['mon', 'tue', 'wed', 'thu', 'fri'].includes(k) ? ['09:00', '17:00'] : null;
    return out;
  });
  const [createLogin, setCreateLogin] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const toggle = (day) => setAvail({ ...avail, [day]: avail[day] ? null : ['09:00', '17:00'] });
  const setTime = (day, idx, v) => {
    const next = [...(avail[day] || ['09:00', '17:00'])];
    next[idx] = v;
    setAvail({ ...avail, [day]: next });
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = {
        ...form,
        fee: Number(form.fee),
        availability: avail,
        createLogin,
        password: createLogin ? form.password : undefined,
      };
      const d = await api('/api/doctors', { method: 'POST', body });
      toast(`Added ${drName(d.doctor.name)} (${d.doctor.doctor_code})`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add doctor" sub="Creates the specialist profile and optional login" onClose={onClose} size="wide" onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add doctor'}</button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <div className="form-row">
        <Field label="Full name" required><input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Rahul Verma" autoFocus /></Field>
        <Field label="Specialization" required><input className="input" value={form.specialization} onChange={set('specialization')} placeholder="e.g. Cardiology" /></Field>
      </div>
      <div className="form-row">
        <Field label="Qualification"><input className="input" value={form.qualification} onChange={set('qualification')} placeholder="e.g. MD, DM" /></Field>
        <Field label="Consultation fee" required hint="0 – 100,000">
          <input className="input" type="number" min="0" max="100000" value={form.fee} onChange={set('fee')} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
      </div>

      <div className="label">Weekly schedule</div>
      {DAYS.map(([k, label]) => (
        <div className="flex" key={k} style={{ marginBottom: 8 }}>
          <label className="check" style={{ minWidth: 130 }}>
            <input type="checkbox" checked={!!avail[k]} onChange={() => toggle(k)} />
            {label}
          </label>
          {avail[k] ? (
            <div className="flex">
              <input className="input" type="time" step="300" value={avail[k][0]} onChange={(e) => setTime(k, 0, e.target.value)} aria-label={`${label} start`} />
              <span className="dim">to</span>
              <input className="input" type="time" step="300" value={avail[k][1]} onChange={(e) => setTime(k, 1, e.target.value)} aria-label={`${label} end`} />
            </div>
          ) : (
            <span className="inline-note">Off</span>
          )}
        </div>
      ))}

      <label className="check mt-14">
        <input type="checkbox" checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} />
        Create a doctor login (email + password)
      </label>
      {createLogin ? (
        <Field label="Login password" required hint="Minimum 6 characters">
          <input className="input" type="password" value={form.password} onChange={set('password')} />
        </Field>
      ) : null}
    </Modal>
  );
}
