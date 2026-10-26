'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell, { useApp } from '@/components/AppShell.js';
import { PageHead, EmptyState, Loading, Modal, Field } from '@/components/ui.js';
import { DataTable, Toolbar, SearchInput, FilterSelect } from '@/components/Table.js';
import { PatientSelect, DoctorSelect } from '@/components/pickers.js';
import { api, toast, toastError, fmtDate, fmtTime, fmtMoney, statusLabel, STATUS_BADGE, todayISO, relDate, can, drName } from '@/lib/client.js';

const STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];

function AppointmentsContent() {
  const { user } = useApp();
  const [data, setData] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [doctorId, setDoctorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [bookOpen, setBookOpen] = useState(false);
  const [reschedule, setReschedule] = useState(null);
  const [detail, setDetail] = useState(null);

  const mayManage = can(user, 'appointment:manage'); // admin + receptionist
  const mayBook = can(user, 'appointment:book');
  const isPatient = user.role === 'patient';
  const isDoctor = user.role === 'doctor';

  const load = useCallback(() => {
    setError('');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status !== 'all') params.set('status', status);
    if (doctorId) params.set('doctorId', doctorId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    api(`/api/appointments?${params}`)
      .then((d) => setData(d))
      .catch((e) => setError(e.message));
  }, [q, status, doctorId, from, to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (user.role === 'admin' || user.role === 'receptionist') {
      api('/api/doctors').then((d) => setDoctors(d.doctors || [])).catch(() => {});
    }
  }, [user.role]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1' && mayBook) setBookOpen(true);
  }, [mayBook]);

  const changeStatus = async (appt, next) => {
    try {
      await api(`/api/appointments/${appt.id}`, { method: 'PUT', body: { status: next } });
      toast(`${appt.appointment_code} marked ${statusLabel(next).toLowerCase()}`, 'success');
      load();
    } catch (e) {
      toastError(e);
    }
  };

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!data) return <Loading label="Loading appointments…" />;

  const rows = data.appointments || [];
  const counts = STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]);

  return (
    <>
      <PageHead
        title={isPatient ? 'My appointments' : 'Appointments'}
        sub={counts.map(([s, c]) => `${c} ${statusLabel(s).toLowerCase()}`).join(' · ')}
      >
        {mayBook ? (
          <Link href="/appointments?new=1" className="btn btn-primary" onClick={(e) => { e.preventDefault(); setBookOpen(true); }}>
            📅 Book appointment
          </Link>
        ) : null}
      </PageHead>

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search patient, code or reason…" />
        <FilterSelect value={status} onChange={setStatus} label="Status"
          options={[{ value: 'all', label: 'All statuses' }, ...STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))]} />
        {!isPatient && !isDoctor ? (
          <FilterSelect value={doctorId} onChange={setDoctorId} label="Doctor"
            options={[{ value: '', label: 'All doctors' }, ...doctors.map((d) => ({ value: String(d.id), label: drName(d.name) }))]} />
        ) : null}
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        {from || to || q || status !== 'all' ? (
          <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setStatus('all'); setFrom(''); setTo(''); setDoctorId(''); }}>Clear</button>
        ) : null}
      </Toolbar>

      <DataTable
        columns={[
          { key: 'date', label: 'Date', cls: 'nowrap', render: (a) => <span className="t-strong">{fmtDate(a.date)}</span> },
          { key: 'time', label: 'Time', cls: 'nowrap', render: (a) => fmtTime(a.time) },
          {
            key: 'patient_name',
            label: isPatient ? 'Doctor' : 'Patient',
            render: (a) => (isPatient ? (
              <div>
                <div className="t-strong">{drName(a.doctor_name)}</div>
                <div className="t-sub">{a.specialization}</div>
              </div>
            ) : (
              <div>
                <div className="t-strong">{a.patient_name} <span className="t-sub mono">{a.patient_code}</span></div>
                <div className="t-sub">{a.patient_phone}</div>
              </div>
            )),
          },
          {
            key: 'doctor_name',
            label: isPatient ? 'Details' : 'Doctor',
            render: (a) => (isPatient ? (
              <div>
                <div>{a.reason}</div>
                <div className="t-sub mono">{a.appointment_code}</div>
              </div>
            ) : (
              <div>
                <div className="t-strong">{drName(a.doctor_name)}</div>
                <div className="t-sub">{a.specialization}</div>
              </div>
            )),
          },
          { key: 'status', label: 'Status', render: (a) => <span className={`badge ${STATUS_BADGE[a.status] || 'badge-info'}`}>{statusLabel(a.status)}</span> },
          {
            key: '_actions',
            label: '',
            align: 'right',
            render: (a) => (
              <div className="flex" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setDetail(a)}>View</button>
                {a.status === 'scheduled' && (mayManage || isPatient) ? (
                  <button className="btn btn-soft btn-sm" onClick={() => setReschedule(a)}>Reschedule</button>
                ) : null}
                {a.status === 'scheduled' && (mayManage || isDoctor) ? (
                  <button className="btn btn-primary btn-sm" onClick={() => changeStatus(a, 'completed')}>Complete</button>
                ) : null}
                {a.status === 'scheduled' && (mayManage || isPatient || isDoctor) ? (
                  <button className="btn btn-danger btn-sm" onClick={() => changeStatus(a, 'cancelled')}>Cancel</button>
                ) : null}
                {a.status === 'scheduled' && mayManage ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => changeStatus(a, 'no_show')}>No-show</button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={rows}
        keyFn={(a) => a.id}
        pageSize={25}
        rowLabel="appointment"
        empty={
          <EmptyState
            icon="📅"
            title="No appointments found"
            sub={q || status !== 'all' || from || to ? 'Try clearing the filters.' : 'Book the first appointment to get started.'}
            action={mayBook ? <button className="btn btn-primary btn-sm" onClick={() => setBookOpen(true)}>Book appointment</button> : null}
          />
        }
      />

      {bookOpen ? (
        <BookModal
          defaultPatient={Number(new URLSearchParams(window.location.search).get('patient')) || null}
          onClose={() => setBookOpen(false)}
          onSaved={() => { setBookOpen(false); load(); }}
        />
      ) : null}
      {reschedule ? (
        <RescheduleModal appointment={reschedule} onClose={() => setReschedule(null)} onSaved={() => { setReschedule(null); load(); }} />
      ) : null}
      {detail ? <DetailModal appointment={detail} onClose={() => setDetail(null)} /> : null}
    </>
  );
}

export default function AppointmentsPage() {
  return (
    <AppShell title="Appointments" crumb="Clinical · scheduling (FR-03 conflict prevention)">
      <AppointmentsContent />
    </AppShell>
  );
}

/* ------------------------------ slot picker ------------------------------ */

function SlotPicker({ doctorId, date, value, onChange, patientId, excludeId }) {
  const [grid, setGrid] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!doctorId || !date) { setGrid(null); return; }
    let alive = true;
    setGrid(null);
    setError('');
    const params = new URLSearchParams({ doctorId: String(doctorId), date });
    if (patientId) params.set('patientId', String(patientId));
    if (excludeId) params.set('excludeId', String(excludeId));
    api(`/api/slots?${params}`)
      .then((d) => alive && setGrid(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [doctorId, date, patientId, excludeId]);

  if (!doctorId || !date) return <p className="inline-note">Pick a doctor and a date to see open slots.</p>;
  if (error) return <div className="alert alert-warning">{error}</div>;
  if (!grid) return <Loading label="Checking availability…" />;

  if (grid.closedReason) {
    return <div className="alert alert-warning">🗓 {grid.closedReason}</div>;
  }

  return (
    <div>
      <div className="flex">
        <span className="label mb-0">Available slots — {fmtTime(grid.window[0])} to {fmtTime(grid.window[1])}</span>
        <span className="right-gap t-sub">{grid.availableCount} open</span>
      </div>
      {grid.availableCount === 0 ? (
        <div className="alert alert-warning mt-8">All slots are taken for this day. Try another date.</div>
      ) : null}
      <div className="slot-grid mt-8">
        {grid.slots.map((s) => (
          <button
            key={s.time}
            type="button"
            className={`slot ${value === s.time ? 'on' : ''}`}
            disabled={!s.available}
            title={s.reason || `${fmtTime(s.time)} available`}
            onClick={() => onChange(s.time)}
          >
            {fmtTime(s.time)}
          </button>
        ))}
      </div>
      <div className="hint">Greyed-out slots are already booked or outside allowed booking time.</div>
    </div>
  );
}

/* ------------------------------ book modal ------------------------------- */

function BookModal({ defaultPatient, onClose, onSaved }) {
  const { user } = useApp();
  const isPatient = user.role === 'patient';
  const [patientId, setPatientId] = useState(defaultPatient);
  const [doctorId, setDoctorId] = useState(null);
  const [date, setDate] = useState(relDate(1));
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const d = await api('/api/appointments', {
        method: 'POST',
        body: { patientId, doctorId, date, time, reason, notes },
      });
      toast(`Booked ${d.appointment.appointment_code} — ${fmtDate(date)} at ${fmtTime(time)}`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Book appointment" sub="Conflicting slots are blocked automatically" onClose={onClose} size="wide"
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !time || !doctorId || (!isPatient && !patientId)}>
            {saving ? 'Booking…' : `Confirm booking${time ? ` · ${fmtTime(time)}` : ''}`}
          </button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      {isPatient ? (
        <div className="alert alert-info">You are booking an appointment for yourself.</div>
      ) : (
        <PatientSelect value={patientId} onChange={setPatientId} required />
      )}
      <DoctorSelect value={doctorId} onChange={setDoctorId} required />
      <Field label="Date" required>
        <input
          className="input" type="date" value={date} min={todayISO()}
          onChange={(e) => { setDate(e.target.value); setTime(''); }}
        />
      </Field>
      <SlotPicker doctorId={doctorId} date={date} value={time} onChange={setTime} patientId={isPatient ? null : patientId} />
      <Field label="Reason for visit" hint="Shown to the doctor on the day">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fever and sore throat for 3 days" />
      </Field>
      <Field label="Notes">
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}

/* --------------------------- reschedule modal ---------------------------- */

function RescheduleModal({ appointment, onClose, onSaved }) {
  const [date, setDate] = useState(appointment.date);
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api(`/api/appointments/${appointment.id}`, { method: 'PUT', body: { date, time } });
      toast(`Rescheduled to ${fmtDate(date)} · ${fmtTime(time)}`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Reschedule appointment" sub={`${appointment.appointment_code} · currently ${fmtDate(appointment.date)} ${fmtTime(appointment.time)}`}
      onClose={onClose} size="wide" onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !time}>{saving ? 'Saving…' : 'Save new time'}</button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <p>
        <b>{appointment.patient_name}</b> with <b>{drName(appointment.doctor_name)}</b> — {appointment.specialization}
      </p>
      <Field label="New date" required>
        <input className="input" type="date" value={date} min={todayISO()} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
      </Field>
      <SlotPicker doctorId={appointment.doctor_id} date={date} value={time} onChange={setTime} patientId={appointment.patient_id} excludeId={appointment.id} />
    </Modal>
  );
}

/* ------------------------------ detail modal ----------------------------- */

function DetailModal({ appointment: a, onClose }) {
  return (
    <Modal title={a.appointment_code} sub={`${fmtDate(a.date)} · ${fmtTime(a.time)}`} onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Close</button>}>
      <div className="kv"><span className="k">Patient</span><span className="v">{a.patient_name} <span className="mono t-sub">{a.patient_code}</span></span></div>
      <div className="kv"><span className="k">Phone</span><span className="v">{a.patient_phone || '—'}</span></div>
      <div className="kv"><span className="k">Doctor</span><span className="v">{drName(a.doctor_name)} · {a.specialization}</span></div>
      <div className="kv"><span className="k">Fee</span><span className="v">{fmtMoney(a.doctor_fee)}</span></div>
      <div className="kv"><span className="k">Reason</span><span className="v">{a.reason}</span></div>
      {a.notes ? <div className="kv"><span className="k">Notes</span><span className="v">{a.notes}</span></div> : null}
      <div className="kv"><span className="k">Status</span><span className="v"><span className={`badge ${STATUS_BADGE[a.status] || 'badge-info'}`}>{statusLabel(a.status)}</span></span></div>
      {a.patient_allergies && a.patient_allergies !== 'None' ? (
        <div className="alert alert-danger mt-14">⚠ Allergies: {a.patient_allergies}</div>
      ) : null}
    </Modal>
  );
}
