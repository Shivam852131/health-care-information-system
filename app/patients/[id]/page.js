'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AppShell, { useApp } from '@/components/AppShell.js';
import { Loading, EmptyState, Modal, Field } from '@/components/ui.js';
import { InvoiceSheet, RxSheet } from '@/components/print.js';
import { api, toast, fmtDate, fmtMoney, statusLabel, STATUS_BADGE, initials, can, drName } from '@/lib/client.js';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'history', label: 'Medical history', clinical: true },
  { key: 'appointments', label: 'Appointments' },
  { key: 'labs', label: 'Lab tests' },
  { key: 'prescriptions', label: 'Prescriptions', clinical: true },
  { key: 'billing', label: 'Billing' },
];

function Detail() {
  const { id } = useParams();
  const { user } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    setError('');
    api(`/api/patients/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!data) return <Loading label="Loading patient record…" />;
  const p = data.patient;

  const mayEdit = can(user, 'patient:update');
  const showClinical = ['admin', 'doctor', 'patient'].includes(user.role);
  const tabs = TABS.filter((t) => !t.clinical || showClinical);
  const active = tabs.some((t) => t.key === tab) ? tab : 'overview';

  return (
    <>
      <div className="profile-head mb-0">
        <div className="avatar avatar-lg">{initials(p.name)}</div>
        <div className="p-meta">
          <h2>{p.name}</h2>
          <div className="p-sub">
            <span className="mono">{p.patient_code}</span> · {p.gender || '—'}
            {p.age !== null && p.age !== undefined ? ` · ${p.age} yrs` : ''}
            {p.blood_group ? ` · Blood ${p.blood_group}` : ''}
            {' · '}<span className={`badge ${STATUS_BADGE[p.status] || 'badge-muted'}`}>{statusLabel(p.status)}</span>
          </div>
        </div>
        <div className="page-actions">
          {mayEdit ? <button className="btn btn-ghost" onClick={() => setEditOpen(true)}>Edit demographics</button> : null}
          {can(user, 'appointment:book') ? (
            <Link href={`/appointments?new=1&patient=${p.id}`} className="btn btn-soft">Book appointment</Link>
          ) : null}
          {can(user, 'invoice:create') ? (
            <Link href={`/billing?new=1&patient=${p.id}`} className="btn btn-primary">New invoice</Link>
          ) : null}
        </div>
      </div>

      <div className="card mt-20">
        <div className="card-body">
          <div className="meta-grid">
            <div className="m-item"><div className="m-label">Date of birth</div><div className="m-value">{p.dob ? fmtDate(p.dob) : '—'}</div></div>
            <div className="m-item"><div className="m-label">Phone</div><div className="m-value">{p.phone || '—'}</div></div>
            <div className="m-item"><div className="m-label">Email</div><div className="m-value">{p.email || '—'}</div></div>
            <div className="m-item"><div className="m-label">Address</div><div className="m-value">{p.address || '—'}</div></div>
            <div className="m-item"><div className="m-label">Allergies</div>
              <div className="m-value" style={p.allergies && p.allergies !== 'None' ? { color: 'var(--danger)' } : undefined}>
                {p.allergies || 'None'}
              </div>
            </div>
            <div className="m-item"><div className="m-label">Emergency contact</div><div className="m-value">{p.emergency_contact || '—'}</div></div>
            <div className="m-item"><div className="m-label">Registered</div><div className="m-value">{fmtDate(p.created_at)}</div></div>
            {p.doctor ? (
              <div className="m-item"><div className="m-label">Usual doctor</div><div className="m-value">{drName(p.doctor.name)} · {p.doctor.specialization}</div></div>
            ) : null}
          </div>
          {p.notes ? <p className="inline-note mt-14">Notes: {p.notes}</p> : null}
        </div>
      </div>

      <div className="tabs mt-20">
        {tabs.map((t) => (
          <button key={t.key} type="button" className={`tab ${active === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {active === 'overview' ? <OverviewTab p={p} showClinical={showClinical} /> : null}
      {active === 'history' ? <HistoryTab p={p} /> : null}
      {active === 'appointments' ? <AppointmentsTab p={p} /> : null}
      {active === 'labs' ? <LabsTab p={p} /> : null}
      {active === 'prescriptions' ? <PrescriptionsTab p={p} /> : null}
      {active === 'billing' ? <BillingTab p={p} /> : null}

      {editOpen ? (
        <EditModal patient={p} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); load(); }} />
      ) : null}
    </>
  );
}

export default function PatientDetailPage() {
  return (
    <AppShell title="Patient record" crumb="Clinical · full chart">
      <Detail />
    </AppShell>
  );
}

/* --------------------------------- tabs ---------------------------------- */

function OverviewTab({ p, showClinical }) {
  const upcoming = (p.appointments || []).filter((a) => a.status === 'scheduled').slice(0, 5).reverse();
  const unpaid = (p.invoices || []).filter((i) => i.status !== 'paid');
  return (
    <div className="grid grid-2 mt-14">
      <div className="card">
        <div className="card-head">
          <div><h3>Upcoming appointments</h3><div className="sub">Scheduled visits</div></div>
          <div className="right"><Link href="/appointments" className="btn btn-soft btn-sm">All →</Link></div>
        </div>
        {upcoming.length ? (
          <div className="list">
            {upcoming.map((a) => (
              <div className="list-row" key={a.id}>
                <div className="time-chip">{fmtDate(a.date).replace(/ \d{4}$/, '')}<div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.85 }}>{a.time}</div></div>
                <div className="grow">
                  <div className="r-title">{drName(a.doctor_name)}</div>
                  <div className="r-sub">{a.specialization} · {a.reason}</div>
                </div>
                <span className={`badge ${STATUS_BADGE[a.status] || 'badge-info'}`}>{statusLabel(a.status)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="📅" title="No upcoming appointments" />
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div><h3>Chart summary</h3><div className="sub">At a glance</div></div>
        </div>
        <div className="card-body">
          <div className="kv"><span className="k">Appointments</span><span className="v">{(p.appointments || []).length} total</span></div>
          {showClinical ? (
            <>
              <div className="kv"><span className="k">Medical records</span><span className="v">{(p.records || []).length}</span></div>
              <div className="kv"><span className="k">Prescriptions</span><span className="v">{(p.prescriptions || []).length}</span></div>
            </>
          ) : null}
          <div className="kv"><span className="k">Lab tests</span><span className="v">{(p.lab_tests || []).length}</span></div>
          <div className="kv"><span className="k">Invoices</span><span className="v">{(p.invoices || []).length}</span></div>
          <div className="kv">
            <span className="k">Outstanding</span>
            <span className="v" style={unpaid.length ? { color: 'var(--danger)' } : undefined}>
              {fmtMoney(unpaid.reduce((s, i) => s + (i.total - i.paid_amount), 0))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryTab({ p }) {
  const rows = p.records || [];
  if (!rows.length) return <EmptyState icon="📝" title="No medical records yet" sub="Consultations recorded by doctors appear here." />;
  return (
    <div className="mt-14">
      {rows.map((r) => (
        <div className="card mb-0 mt-14" key={r.id}>
          <div className="card-head">
            <div>
              <h3>{r.diagnosis}</h3>
              <div className="sub">{fmtDate(r.visit_date)} · {r.doctor_name ? drName(r.doctor_name) : 'Unassigned'}{r.specialization ? ` · ${r.specialization}` : ''}</div>
            </div>
            <div className="right"><span className="pill mono">{r.record_code}</span></div>
          </div>
          <div className="card-body">
            {r.treatment ? (<><div className="label">Treatment</div><p style={{ marginTop: 0 }}>{r.treatment}</p></>) : null}
            {r.notes ? <p className="inline-note">Notes: {r.notes}</p> : null}
            {r.updated_at && r.updated_by_name ? (
              <div className="t-sub mt-8">Last edited {fmtDate(r.updated_at)} by {r.updated_by_name}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function AppointmentsTab({ p }) {
  const rows = p.appointments || [];
  if (!rows.length) return <EmptyState icon="📅" title="No appointments yet" />;
  return (
    <div className="card mt-14">
      <div className="list scroll-y">
        {rows.map((a) => (
          <div className="list-row" key={a.id}>
            <div className="time-chip">{fmtDate(a.date).replace(/ \d{4}$/, '')}<div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.85 }}>{a.time}</div></div>
            <div className="grow">
              <div className="r-title">{drName(a.doctor_name)} <span className="t-sub mono">{a.appointment_code}</span></div>
              <div className="r-sub">{a.specialization} · {a.reason}</div>
            </div>
            <span className={`badge ${STATUS_BADGE[a.status] || 'badge-info'}`}>{statusLabel(a.status)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LabsTab({ p }) {
  const rows = p.lab_tests || [];
  const [viewing, setViewing] = useState(null);
  if (!rows.length) return <EmptyState icon="🧪" title="No lab tests yet" />;
  return (
    <>
      <div className="card mt-14">
        <div className="list scroll-y">
          {rows.map((t) => (
            <div className="list-row" key={t.id}>
              <div className="grow">
                <div className="r-title">{t.test_name} <span className="t-sub mono">{t.test_code}</span></div>
                <div className="r-sub">{t.category} · ordered {fmtDate(t.requested_at)}</div>
              </div>
              <div className="r-right">
                <span className={`badge ${t.status === 'completed' ? 'badge-success' : t.status === 'in_progress' ? 'badge-info' : 'badge-warning'}`}>
                  {statusLabel(t.status)}
                </span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setViewing(t)}>View</button>
            </div>
          ))}
        </div>
      </div>
      {viewing ? <LabModal test={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

function LabModal({ test, onClose }) {
  return (
    <Modal title={test.test_name} sub={`${test.test_code} · ${test.category}`} onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Close</button>}>
      <div className="kv"><span className="k">Status</span><span className="v">{statusLabel(test.status)}</span></div>
      <div className="kv"><span className="k">Ordered</span><span className="v">{fmtDate(test.requested_at)}{test.requested_by_name ? ` by ${test.requested_by_name}` : ''}</span></div>
      {test.reference_range ? <div className="kv"><span className="k">Reference</span><span className="v">{test.reference_range}</span></div> : null}
      {test.result ? (<><div className="label mt-14">Result</div><p style={{ marginTop: 0 }}>{test.result}</p></>) : <p className="inline-note">No result recorded yet.</p>}
      {test.completed_at ? <div className="t-sub">Completed {fmtDate(test.completed_at)}</div> : null}
      {test.file_name ? (
        <p className="mt-14">
          <a className="btn btn-soft" href={`/api/files/lab/${test.id}`}>📎 Download report ({test.original_name || 'file'})</a>
        </p>
      ) : null}
    </Modal>
  );
}

function PrescriptionsTab({ p }) {
  const rows = p.prescriptions || [];
  const [viewing, setViewing] = useState(null);
  if (!rows.length) return <EmptyState icon="💊" title="No prescriptions yet" />;
  return (
    <>
      <div className="card mt-14">
        <div className="list scroll-y">
          {rows.map((rx) => (
            <div className="list-row" key={rx.id}>
              <div className="grow">
                <div className="r-title">{rx.diagnosis} <span className="t-sub mono">{rx.rx_code}</span></div>
                <div className="r-sub">
                  {drName(rx.doctor_name)} · {fmtDate(rx.issued_date)} · {(rx.medicines || []).length} medicine(s)
                  {rx.follow_up ? ` · follow-up: ${rx.follow_up}` : ''}
                </div>
              </div>
              <span className={`badge ${rx.status === 'active' ? 'badge-brand' : rx.status === 'completed' ? 'badge-success' : 'badge-muted'}`}>{statusLabel(rx.status)}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setViewing(rx)}>View</button>
            </div>
          ))}
        </div>
      </div>
      {viewing ? <RxModal rx={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

function RxModal({ rx, onClose }) {
  return (
    <Modal title="Prescription" sub={rx.rx_code} onClose={onClose} size="wide"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>🖨 Print</button>
        </>
      }>
      <RxSheet rx={rx} />
    </Modal>
  );
}

function BillingTab({ p }) {
  const rows = p.invoices || [];
  const [viewing, setViewing] = useState(null);
  if (!rows.length) return <EmptyState icon="🧾" title="No invoices yet" />;
  return (
    <>
      <div className="card mt-14">
        <div className="list scroll-y">
          {rows.map((inv) => (
            <div className="list-row" key={inv.id}>
              <div className="grow">
                <div className="r-title">{inv.invoice_no}</div>
                <div className="r-sub">Issued {fmtDate(inv.issue_date)} · Total {fmtMoney(inv.total)} · Paid {fmtMoney(inv.paid_amount)}</div>
              </div>
              <div className="r-right">{fmtMoney(Math.max(0, inv.total - inv.paid_amount))} due</div>
              <span className={`badge ${STATUS_BADGE[inv.status] === 'badge-success' ? 'badge-success' : inv.status === 'paid' ? 'badge-success' : inv.status === 'partial' ? 'badge-warning' : 'badge-info'}`}>{statusLabel(inv.status)}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setViewing(inv)}>View</button>
            </div>
          ))}
        </div>
      </div>
      {viewing ? <InvoicePreviewModal invoiceId={viewing.id} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

function InvoicePreviewModal({ invoiceId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/api/invoices/${invoiceId}`).then(setData).catch((e) => setError(e.message));
  }, [invoiceId]);
  if (error) return <Modal title="Invoice" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}><div className="alert alert-danger">{error}</div></Modal>;
  if (!data) return <Modal title="Invoice" onClose={onClose}><Loading label="Loading invoice…" /></Modal>;
  const { invoice: inv, settings } = data;
  return (
    <Modal title={`Invoice ${inv.invoice_no}`} onClose={onClose} size="wide"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>🖨 Print</button>
        </>
      }>
      <InvoiceSheet inv={inv} settings={settings} />
    </Modal>
  );
}



/* ------------------------------ edit modal -------------------------------- */

function EditModal({ patient, onClose, onSaved }) {
  const { user } = useApp();
  const [form, setForm] = useState({
    name: patient.name, dob: patient.dob || '', gender: patient.gender || 'Male',
    blood_group: patient.blood_group || '', phone: patient.phone || '', email: patient.email || '',
    address: patient.address || '', allergies: patient.allergies || '', emergency_contact: patient.emergency_contact || '',
    notes: patient.notes || '', status: patient.status,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { ...form };
      if (user.role !== 'admin') delete body.status; // server enforces; hide for reception
      await api(`/api/patients/${patient.id}`, { method: 'PUT', body });
      toast('Patient record updated', 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit demographics" sub={patient.patient_code} onClose={onClose} size="wide" onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <div className="form-row">
        <Field label="Full name" required><input className="input" value={form.name} onChange={set('name')} /></Field>
        <Field label="Date of birth"><input className="input" type="date" value={form.dob} onChange={set('dob')} max={new Date().toISOString().slice(0, 10)} /></Field>
      </div>
      <div className="form-row">
        <Field label="Gender">
          <select className="select" value={form.gender} onChange={set('gender')}>
            {['Male', 'Female', 'Other'].map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Blood group"><input className="input" value={form.blood_group} onChange={set('blood_group')} /></Field>
      </div>
      <div className="form-row">
        <Field label="Phone" required><input className="input" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
      </div>
      <Field label="Address"><input className="input" value={form.address} onChange={set('address')} /></Field>
      <div className="form-row">
        <Field label="Allergies"><input className="input" value={form.allergies} onChange={set('allergies')} /></Field>
        <Field label="Emergency contact"><input className="input" value={form.emergency_contact} onChange={set('emergency_contact')} /></Field>
      </div>
      <Field label="Notes"><textarea className="textarea" value={form.notes} onChange={set('notes')} /></Field>
      {user.role === 'admin' ? (
        <Field label="Record status" hint="Inactive patients cannot be booked">
          <select className="select" value={form.status} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      ) : null}
    </Modal>
  );
}
