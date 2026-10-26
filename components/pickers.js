'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, toastError, ageFromDob, fmtMoney } from '@/lib/client.js';
import { Field } from './ui.js';

/**
 * Searchable patient picker (used by booking, records, labs, prescriptions, billing).
 * Loads the patient directory once, then filters locally.
 */
export function PatientSelect({ id, value, onChange, label = 'Patient', required, autoFocus, disabled }) {
  const [list, setList] = useState(null);
  const [term, setTerm] = useState('');

  useEffect(() => {
    api('/api/patients')
      .then((d) => setList(d.patients || []))
      .catch((e) => toastError(e));
  }, []);

  const filtered = useMemo(() => {
    if (!list) return [];
    const t = term.trim().toLowerCase();
    const base = t
      ? list.filter(
          (p) =>
            p.name.toLowerCase().includes(t) ||
            p.patient_code.toLowerCase().includes(t) ||
            String(p.phone || '').includes(t)
        )
      : list;
    const selected = value ? list.find((p) => p.id === Number(value)) : null;
    const out = base.slice(0, 300);
    if (selected && !out.some((p) => p.id === selected.id)) out.unshift(selected);
    return out;
  }, [list, term, value]);

  const selected = value ? (list || []).find((p) => p.id === Number(value)) : null;

  return (
    <Field label={label} id={id} required={required}>
      <input
        className="input"
        type="search"
        placeholder="Filter by name, code or phone…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        disabled={disabled}
        aria-label="Filter patients"
      />
      <select
        id={id}
        className="select"
        style={{ marginTop: 7 }}
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value) || null)}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
      >
        <option value="">
          {list === null ? 'Loading patients…' : filtered.length ? '— Select patient —' : 'No matching patients'}
        </option>
        {filtered.map((p) => {
          const age = ageFromDob(p.dob);
          return (
            <option key={p.id} value={p.id}>
              {p.patient_code} · {p.name}
              {age !== null ? ` (${age}${p.gender ? ` ${p.gender[0]}` : ''})` : ''}
            </option>
          );
        })}
      </select>
      {selected ? (
        <div className="hint">
          {selected.patient_code} · {selected.phone || 'no phone'}
          {selected.allergies && selected.allergies !== 'None' ? (
            <span style={{ color: 'var(--danger)', fontWeight: 700 }}> · ⚠ Allergies: {selected.allergies}</span>
          ) : null}
        </div>
      ) : null}
    </Field>
  );
}

/** Doctor picker with specialization + fee shown. */
export function DoctorSelect({ id, value, onChange, label = 'Doctor', required, autoFocus, includeInactive }) {
  const [list, setList] = useState(null);

  useEffect(() => {
    api('/api/doctors')
      .then((d) => setList(d.doctors || []))
      .catch((e) => toastError(e));
  }, []);

  const options = (list || []).filter((d) => includeInactive || d.status === 'active');

  return (
    <Field label={label} id={id} required={required}>
      <select
        id={id}
        className="select"
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value) || null)}
        required={required}
        disabled={!list}
        autoFocus={autoFocus}
      >
        <option value="">
          {list === null ? 'Loading doctors…' : options.length ? '— Select doctor —' : 'No doctors available'}
        </option>
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {d.specialization} · {fmtMoney(d.fee)}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Compact human summary of a weekly availability map. */
export function availabilitySummary(availability = {}) {
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const labels = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const groups = [];
  for (const d of days) {
    const win = availability[d] || null;
    const key = win ? win.join('-') : 'closed';
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.days.push(d);
    else groups.push({ key, win, days: [d] });
  }
  return groups
    .map((g) => {
      const dayText =
        g.days.length === 1 ? labels[g.days[0]] : `${labels[g.days[0]]}–${labels[g.days[g.days.length - 1]]}`;
      return g.win ? `${dayText} ${g.win[0]}–${g.win[1]}` : `${dayText} off`;
    })
    .join(' · ');
}
