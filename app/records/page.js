'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell, { useApp } from '@/components/AppShell.js';
import { PageHead, EmptyState, Loading, Modal, Field } from '@/components/ui.js';
import { DataTable, Toolbar, SearchInput } from '@/components/Table.js';
import { PatientSelect, DoctorSelect } from '@/components/pickers.js';
import { api, toast, toastError, fmtDate, todayISO, can, drName } from '@/lib/client.js';

function RecordsContent() {
  const { user } = useApp();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [newOpen, setNewOpen] = useState(false);

  const mayWrite = can(user, 'record:create');

  const load = useCallback(() => {
    setError('');
    api(`/api/records${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then((d) => setRows(d.records || []))
      .catch((e) => setError(e.message));
  }, [q]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1' && mayWrite) setNewOpen(true);
  }, [mayWrite]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!rows) return <Loading label="Loading medical records…" />;

  const isDoctor = user.role === 'doctor';

  return (
    <>
      <PageHead title="Medical records" sub={`${rows.length} consultation${rows.length === 1 ? '' : 's'} · diagnoses and treatment notes`}>
        {mayWrite ? (
          <Link href="/records?new=1" className="btn btn-primary" onClick={(e) => { e.preventDefault(); setNewOpen(true); }}>
            ＋ New record
          </Link>
        ) : null}
      </PageHead>

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search diagnosis, treatment, code or patient…" />
      </Toolbar>

      <DataTable
        columns={[
          { key: 'visit_date', label: 'Visit', cls: 'nowrap', render: (r) => <span className="t-strong">{fmtDate(r.visit_date)}</span> },
          {
            key: 'patient_name',
            label: 'Patient',
            render: (r) => (
              <div>
                <div className="t-strong">{r.patient_name}</div>
                <div className="t-sub mono">{r.patient_code}</div>
              </div>
            ),
          },
          { key: 'doctor_name', label: 'Doctor', render: (r) => (r.doctor_name ? drName(r.doctor_name) : '—') },
          { key: 'diagnosis', label: 'Diagnosis', render: (r) => <span className="t-strong">{r.diagnosis}</span> },
          {
            key: 'treatment',
            label: 'Treatment',
            render: (r) => (r.treatment ? <span className="t-sub">{r.treatment.slice(0, 80)}{r.treatment.length > 80 ? '…' : ''}</span> : '—'),
          },
          {
            key: '_actions',
            label: '',
            align: 'right',
            render: (r) => (
              <div className="flex" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setViewing(r)}>View</button>
                {mayWrite && (!isDoctor || user.linked_doctor_id === r.doctor_id) ? (
                  <button className="btn btn-soft btn-sm" onClick={() => setEditing(r)}>Edit</button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={rows}
        keyFn={(r) => r.id}
        pageSize={20}
        rowLabel="medical record"
        empty={
          <EmptyState
            icon="📝"
            title="No medical records"
            sub={q ? 'Try a different search.' : 'Consultations recorded by doctors appear here.'}
            action={mayWrite ? <button className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>New record</button> : null}
          />
        }
      />

      {viewing ? <ViewModal record={viewing} onClose={() => setViewing(null)} /> : null}
      {editing ? <EditModal record={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
      {newOpen ? <NewModal onClose={() => setNewOpen(false)} onSaved={() => { setNewOpen(false); load(); }} /> : null}
    </>
  );
}

export default function RecordsPage() {
  return (
    <AppShell title="Medical Records" crumb="Clinical · consultation history (FR-05)">
      <RecordsContent />
    </AppShell>
  );
}

/* ------------------------------- view modal ------------------------------ */

function ViewModal({ record: r, onClose }) {
  return (
    <Modal title={r.diagnosis} sub={`${r.record_code} · ${fmtDate(r.visit_date)}`} onClose={onClose} size="wide"
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Close</button>}>
      <div className="kv"><span className="k">Patient</span><span className="v">{r.patient_name} <span className="mono t-sub">{r.patient_code}</span></span></div>
      <div className="kv"><span className="k">Doctor</span><span className="v">{r.doctor_name ? drName(r.doctor_name) : '—'}{r.specialization ? ` · ${r.specialization}` : ''}</span></div>
      <div className="kv"><span className="k">Visit date</span><span className="v">{fmtDate(r.visit_date)}</span></div>
      <div className="mt-14"><div className="label">Diagnosis</div><p style={{ marginTop: 0 }}>{r.diagnosis}</p></div>
      {r.treatment ? <div><div className="label">Treatment</div><p style={{ marginTop: 0 }}>{r.treatment}</p></div> : null}
      {r.notes ? <div><div className="label">Notes</div><p style={{ marginTop: 0 }}>{r.notes}</p></div> : null}
      <div className="t-sub mt-14">
        Created {fmtDate(r.created_at)}
        {r.updated_at && r.updated_by_name ? ` · last updated ${fmtDate(r.updated_at)} by ${r.updated_by_name}` : ''}
      </div>
    </Modal>
  );
}

/* ------------------------------- edit modal ------------------------------ */

function EditModal({ record: r, onClose, onSaved }) {
  const [form, setForm] = useState({ visitDate: r.visit_date, diagnosis: r.diagnosis, treatment: r.treatment || '', notes: r.notes || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api(`/api/records/${r.id}`, { method: 'PUT', body: form });
      toast('Record updated — timestamp and author recorded', 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit record" sub={`${r.record_code} · ${r.patient_name}`} onClose={onClose} size="wide" onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <Field label="Visit date" required>
        <input className="input" type="date" value={form.visitDate} onChange={set('visitDate')} max={todayISO()} />
      </Field>
      <Field label="Diagnosis" required hint="Minimum 3 characters">
        <input className="input" value={form.diagnosis} onChange={set('diagnosis')} />
      </Field>
      <Field label="Treatment"><textarea className="textarea" value={form.treatment} onChange={set('treatment')} /></Field>
      <Field label="Notes"><textarea className="textarea" value={form.notes} onChange={set('notes')} /></Field>
    </Modal>
  );
}

/* ------------------------------- new modal ------------------------------- */

function NewModal({ onClose, onSaved }) {
  const { user } = useApp();
  const isAdmin = user.role === 'admin';
  const [patientId, setPatientId] = useState(null);
  const [doctorId, setDoctorId] = useState(null);
  const [form, setForm] = useState({ visitDate: todayISO(), diagnosis: '', treatment: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { ...form, patientId };
      if (isAdmin && doctorId) body.doctorId = doctorId;
      const d = await api('/api/records', { method: 'POST', body });
      toast(`Record ${d.record.record_code} created`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New medical record" sub="Consultation note — attributed to the logged-in doctor" onClose={onClose} size="wide"
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !patientId || form.diagnosis.trim().length < 3}>
            {saving ? 'Saving…' : 'Create record'}
          </button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <PatientSelect value={patientId} onChange={setPatientId} required />
      {isAdmin ? <DoctorSelect value={doctorId} onChange={setDoctorId} label="Attending doctor" /> : null}
      <Field label="Visit date" required hint="Cannot be in the future">
        <input className="input" type="date" value={form.visitDate} onChange={set('visitDate')} max={todayISO()} />
      </Field>
      <Field label="Diagnosis" required hint="Minimum 3 characters, max 400">
        <input className="input" value={form.diagnosis} onChange={set('diagnosis')} placeholder="e.g. Acute bacterial tonsillitis" autoFocus />
      </Field>
      <Field label="Treatment"><textarea className="textarea" value={form.treatment} onChange={set('treatment')} placeholder="Prescribed antibiotics, hydration advice…" /></Field>
      <Field label="Notes"><textarea className="textarea" value={form.notes} onChange={set('notes')} /></Field>
    </Modal>
  );
}
