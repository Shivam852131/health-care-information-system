'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell, { useApp } from '@/components/AppShell.js';
import { PageHead, EmptyState, Loading, Modal, Field } from '@/components/ui.js';
import { DataTable, Toolbar, SearchInput, FilterSelect } from '@/components/Table.js';
import { PatientSelect, DoctorSelect } from '@/components/pickers.js';
import { RxSheet } from '@/components/print.js';
import { api, toast, toastError, fmtDate, todayISO, statusLabel, can, drName } from '@/lib/client.js';

const STATUSES = ['active', 'completed', 'cancelled'];
const rxBadge = (s) => (s === 'active' ? 'badge-brand' : s === 'completed' ? 'badge-success' : 'badge-muted');

function PrescriptionsContent() {
  const { user } = useApp();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [viewing, setViewing] = useState(null);
  const [newOpen, setNewOpen] = useState(false);

  const mayWrite = can(user, 'rx:create');

  const load = useCallback(() => {
    setError('');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status !== 'all') params.set('status', status);
    api(`/api/prescriptions?${params}`)
      .then((d) => setRows(d.prescriptions || []))
      .catch((e) => setError(e.message));
  }, [q, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1' && mayWrite) setNewOpen(true);
  }, [mayWrite]);

  const markStatus = async (rx, next) => {
    try {
      await api(`/api/prescriptions/${rx.id}`, { method: 'PUT', body: { status: next } });
      toast(`${rx.rx_code} marked ${next}`, 'success');
      load();
    } catch (e) {
      toastError(e);
    }
  };

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!rows) return <Loading label="Loading prescriptions…" />;

  return (
    <>
      <PageHead title="Prescriptions" sub={`${rows.length} prescription${rows.length === 1 ? '' : 's'} · medicine plans (FR-07)`}>
        {mayWrite ? (
          <Link href="/prescriptions?new=1" className="btn btn-primary" onClick={(e) => { e.preventDefault(); setNewOpen(true); }}>
            💊 New prescription
          </Link>
        ) : null}
      </PageHead>

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search patient, diagnosis, doctor or code…" />
        <FilterSelect value={status} onChange={setStatus} label="Status"
          options={[{ value: 'all', label: 'All statuses' }, ...STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))]} />
      </Toolbar>

      <DataTable
        columns={[
          { key: 'rx_code', label: 'Code', cls: 'mono' },
          { key: 'issued_date', label: 'Issued', cls: 'nowrap', render: (rx) => fmtDate(rx.issued_date) },
          {
            key: 'patient_name',
            label: 'Patient',
            render: (rx) => (
              <div>
                <div className="t-strong">{rx.patient_name}</div>
                <div className="t-sub mono">{rx.patient_code}</div>
              </div>
            ),
          },
          { key: 'doctor_name', label: 'Doctor', render: (rx) => drName(rx.doctor_name) },
          {
            key: 'diagnosis',
            label: 'Diagnosis',
            render: (rx) => (
              <div>
                <div>{rx.diagnosis}</div>
                <div className="t-sub">{(rx.medicines || []).length} medicine(s){rx.follow_up ? ` · follow-up: ${rx.follow_up}` : ''}</div>
              </div>
            ),
          },
          { key: 'status', label: 'Status', render: (rx) => <span className={`badge ${rxBadge(rx.status)}`}>{statusLabel(rx.status)}</span> },
          {
            key: '_actions',
            label: '',
            align: 'right',
            render: (rx) => (
              <div className="flex" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setViewing(rx)}>View</button>
                {mayWrite && rx.status === 'active' ? (
                  <button className="btn btn-soft btn-sm" onClick={() => markStatus(rx, 'completed')}>Complete</button>
                ) : null}
                {mayWrite && rx.status === 'active' ? (
                  <button className="btn btn-danger btn-sm" onClick={() => markStatus(rx, 'cancelled')}>Cancel</button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={rows}
        keyFn={(rx) => rx.id}
        pageSize={20}
        rowLabel="prescription"
        empty={
          <EmptyState
            icon="💊"
            title="No prescriptions"
            sub={q || status !== 'all' ? 'Try different filters.' : 'Doctors create prescriptions from here.'}
            action={mayWrite ? <button className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>New prescription</button> : null}
          />
        }
      />

      {viewing ? (
        <Modal title="Prescription" sub={`${viewing.rx_code} · ${viewing.patient_name}`} onClose={() => setViewing(null)} size="wide"
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setViewing(null)}>Close</button>
              <button type="button" className="btn btn-primary" onClick={() => window.print()}>🖨 Print</button>
            </>
          }>
          <RxSheet rx={viewing} />
        </Modal>
      ) : null}
      {newOpen ? <NewModal onClose={() => setNewOpen(false)} onSaved={() => { setNewOpen(false); load(); }} /> : null}
    </>
  );
}

export default function PrescriptionsPage() {
  return (
    <AppShell title="Prescriptions" crumb="Clinical · medicine plans and printouts">
      <PrescriptionsContent />
    </AppShell>
  );
}

/* ------------------------------- new modal ------------------------------- */

const EMPTY_MED = { name: '', strength: '', dosage: '', frequency: '', duration: '', notes: '' };

function NewModal({ onClose, onSaved }) {
  const { user } = useApp();
  const isAdmin = user.role === 'admin';
  const [patientId, setPatientId] = useState(null);
  const [doctorId, setDoctorId] = useState(null);
  const [diagnosis, setDiagnosis] = useState('');
  const [instructions, setInstructions] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [issuedDate, setIssuedDate] = useState(todayISO());
  const [meds, setMeds] = useState([{ ...EMPTY_MED }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setMed = (i, k) => (e) => {
    const next = [...meds];
    next[i] = { ...next[i], [k]: e.target.value };
    setMeds(next);
  };
  const addMed = () => meds.length < 25 && setMeds([...meds, { ...EMPTY_MED }]);
  const removeMed = (i) => meds.length > 1 && setMeds(meds.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { patientId, diagnosis, instructions, followUp, issuedDate, medicines: meds };
      if (isAdmin && doctorId) body.doctorId = doctorId;
      const d = await api('/api/prescriptions', { method: 'POST', body });
      toast(`Prescription ${d.prescription.rx_code} issued`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New prescription" sub="Medicines are validated server-side (FR-07)" onClose={onClose} size="wide"
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !patientId || diagnosis.trim().length < 3}>
            {saving ? 'Issuing…' : 'Issue prescription'}
          </button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <PatientSelect value={patientId} onChange={setPatientId} required />
      {isAdmin ? <DoctorSelect value={doctorId} onChange={setDoctorId} label="Prescribing doctor" required /> : null}
      <div className="form-row">
        <Field label="Diagnosis / indication" required>
          <input className="input" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="e.g. Acute bacterial tonsillitis" autoFocus />
        </Field>
        <Field label="Prescription date" required hint="Cannot be dated in the future">
          <input className="input" type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} max={todayISO()} />
        </Field>
      </div>

      <div className="label">Medicines <span className="dim">({meds.length}/25)</span></div>
      <div className="med-row" style={{ marginBottom: 4 }}>
        <span className="t-sub">Medicine</span><span className="t-sub">Strength</span><span className="t-sub">Dosage</span>
        <span className="t-sub">Frequency</span><span className="t-sub">Duration</span><span />
      </div>
      {meds.map((m, i) => (
        <div className="med-row" key={i}>
          <input className="input" placeholder="Amoxicillin" value={m.name} onChange={setMed(i, 'name')} aria-label={`Medicine ${i + 1} name`} />
          <input className="input" placeholder="500 mg" value={m.strength} onChange={setMed(i, 'strength')} aria-label="Strength" />
          <input className="input" placeholder="1 tab" value={m.dosage} onChange={setMed(i, 'dosage')} aria-label="Dosage" />
          <input className="input" placeholder="3x daily after food" value={m.frequency} onChange={setMed(i, 'frequency')} aria-label="Frequency" />
          <input className="input" placeholder="5 days" value={m.duration} onChange={setMed(i, 'duration')} aria-label="Duration" />
          <button type="button" className="icon-btn" onClick={() => removeMed(i)} disabled={meds.length === 1} aria-label="Remove medicine">✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-soft btn-sm mt-8" onClick={addMed} disabled={meds.length >= 25}>＋ Add medicine</button>

      <div className="mt-14">
        <Field label="Instructions" hint="Shown on the printed sheet">
          <textarea className="textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Complete the full course; return if symptoms persist beyond 3 days." />
        </Field>
      </div>
      <Field label="Follow-up" hint="Free-text, e.g. 'Review after 7 days'">
        <input className="input" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
      </Field>
    </Modal>
  );
}
