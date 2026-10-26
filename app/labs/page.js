'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell, { useApp } from '@/components/AppShell.js';
import { PageHead, EmptyState, Loading, Modal, Field } from '@/components/ui.js';
import { DataTable, Toolbar, SearchInput, FilterSelect } from '@/components/Table.js';
import { PatientSelect } from '@/components/pickers.js';
import { api, toast, toastError, fmtDate, can } from '@/lib/client.js';

const STATUSES = ['requested', 'in_progress', 'completed'];
const statusBadge = (s) => (s === 'completed' ? 'badge-success' : s === 'in_progress' ? 'badge-info' : 'badge-warning');

function LabsContent() {
  const { user } = useApp();
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [orderOpen, setOrderOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [resultFor, setResultFor] = useState(null);

  const mayOrder = can(user, 'lab:order'); // admin, doctor, receptionist
  const mayResult = can(user, 'lab:result'); // admin, lab

  const load = useCallback(() => {
    setError('');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status !== 'all') params.set('status', status);
    api(`/api/labs?${params}`)
      .then((d) => { setRows(d.lab_tests || []); setCounts(d.counts || {}); })
      .catch((e) => setError(e.message));
  }, [q, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1' && mayOrder) setOrderOpen(true);
  }, [mayOrder]);

  const advance = async (t, next) => {
    try {
      await api(`/api/labs/${t.id}`, { method: 'PUT', body: { status: next } });
      toast(`${t.test_code} → ${next.replace('_', ' ')}`, 'success');
      load();
    } catch (e) {
      toastError(e);
    }
  };

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!rows) return <Loading label="Loading lab tests…" />;

  return (
    <>
      <PageHead
        title="Laboratory"
        sub={`${counts.requested || 0} requested · ${counts.in_progress || 0} in progress · ${counts.completed || 0} completed`}
      >
        {mayOrder ? (
          <Link href="/labs?new=1" className="btn btn-primary" onClick={(e) => { e.preventDefault(); setOrderOpen(true); }}>
            🧪 Order test
          </Link>
        ) : null}
      </PageHead>

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search test, code, category or patient…" />
        <FilterSelect value={status} onChange={setStatus} label="Status"
          options={[{ value: 'all', label: 'All statuses' }, ...STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))]} />
      </Toolbar>

      <DataTable
        columns={[
          { key: 'test_code', label: 'Code', cls: 'mono' },
          { key: 'test_name', label: 'Test', render: (t) => (<div><div className="t-strong">{t.test_name}</div><div className="t-sub">{t.category}</div></div>) },
          {
            key: 'patient_name',
            label: 'Patient',
            render: (t) => (
              <div>
                <div>{t.patient_name}</div>
                <div className="t-sub mono">{t.patient_code}</div>
              </div>
            ),
          },
          { key: 'requested_at', label: 'Ordered', cls: 'nowrap', render: (t) => fmtDate(t.requested_at) },
          { key: 'requested_by_name', label: 'By', render: (t) => t.requested_by_name || '—' },
          { key: 'status', label: 'Status', render: (t) => <span className={`badge ${statusBadge(t.status)}`}>{t.status.replace('_', ' ')}</span> },
          {
            key: '_actions',
            label: '',
            align: 'right',
            render: (t) => (
              <div className="flex" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setViewing(t)}>View</button>
                {mayResult && t.status === 'requested' ? (
                  <button className="btn btn-soft btn-sm" onClick={() => advance(t, 'in_progress')}>Start</button>
                ) : null}
                {mayResult && t.status !== 'completed' ? (
                  <button className="btn btn-primary btn-sm" onClick={() => setResultFor(t)}>{t.result || t.file_name ? 'Complete' : 'Add result'}</button>
                ) : null}
                {t.file_name && t.status === 'completed' ? (
                  <a className="btn btn-soft btn-sm" href={`/api/files/lab/${t.id}`}>📥 File</a>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={rows}
        keyFn={(t) => t.id}
        pageSize={20}
        rowLabel="lab test"
        empty={
          <EmptyState
            icon="🧪"
            title="No lab tests"
            sub={q || status !== 'all' ? 'Try different filters.' : 'Ordered tests appear here for processing.'}
            action={mayOrder ? <button className="btn btn-primary btn-sm" onClick={() => setOrderOpen(true)}>Order test</button> : null}
          />
        }
      />

      {orderOpen ? <OrderModal onClose={() => setOrderOpen(false)} onSaved={() => { setOrderOpen(false); load(); }} /> : null}
      {viewing ? <ViewModal test={viewing} onClose={() => setViewing(null)} /> : null}
      {resultFor ? <ResultModal test={resultFor} onClose={() => setResultFor(null)} onSaved={() => { setResultFor(null); load(); }} /> : null}
    </>
  );
}

export default function LabsPage() {
  return (
    <AppShell title="Laboratory" crumb="Diagnostics · orders, results and report files (FR-05)">
      <LabsContent />
    </AppShell>
  );
}

/* ------------------------------- order modal ----------------------------- */

function OrderModal({ onClose, onSaved }) {
  const [patientId, setPatientId] = useState(null);
  const [form, setForm] = useState({ testName: '', category: 'General', referenceRange: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const d = await api('/api/labs', { method: 'POST', body: { ...form, patientId } });
      toast(`Ordered ${d.lab_test.test_code} — ${d.lab_test.test_name}`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Order lab test" sub="Queued for the laboratory team" onClose={onClose} onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !patientId || form.testName.trim().length < 2}>
            {saving ? 'Ordering…' : 'Order test'}
          </button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <PatientSelect value={patientId} onChange={setPatientId} required />
      <Field label="Test name" required hint="e.g. Complete Blood Count, Lipid Profile, HbA1c">
        <input className="input" value={form.testName} onChange={set('testName')} autoFocus />
      </Field>
      <div className="form-row">
        <Field label="Category"><input className="input" value={form.category} onChange={set('category')} placeholder="General" /></Field>
        <Field label="Reference range"><input className="input" value={form.referenceRange} onChange={set('referenceRange')} placeholder="e.g. 4–11 x10^9/L" /></Field>
      </div>
      <Field label="Notes"><textarea className="textarea" value={form.notes} onChange={set('notes')} /></Field>
    </Modal>
  );
}

/* ------------------------------- view modal ------------------------------ */

function ViewModal({ test: t, onClose }) {
  return (
    <Modal title={t.test_name} sub={`${t.test_code} · ${t.category}`} onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Close</button>}>
      <div className="kv"><span className="k">Patient</span><span className="v">{t.patient_name} <span className="mono t-sub">{t.patient_code}</span></span></div>
      <div className="kv"><span className="k">Ordered</span><span className="v">{fmtDate(t.requested_at)}{t.requested_by_name ? ` by ${t.requested_by_name}` : ''}</span></div>
      <div className="kv"><span className="k">Status</span><span className="v"><span className={`badge ${statusBadge(t.status)}`}>{t.status.replace('_', ' ')}</span></span></div>
      {t.reference_range ? <div className="kv"><span className="k">Reference</span><span className="v">{t.reference_range}</span></div> : null}
      {t.notes ? <div className="kv"><span className="k">Notes</span><span className="v">{t.notes}</span></div> : null}
      <div className="mt-14"><div className="label">Result</div>{t.result ? <p style={{ marginTop: 0 }}>{t.result}</p> : <p className="inline-note" style={{ marginTop: 0 }}>No result recorded yet.</p>}</div>
      {t.completed_at ? <div className="t-sub">Completed {fmtDate(t.completed_at)}{t.uploaded_by_name ? ` · uploaded by ${t.uploaded_by_name}` : ''}</div> : null}
      {t.file_name ? (
        <p className="mt-14"><a className="btn btn-soft" href={`/api/files/lab/${t.id}`}>📎 Download report ({t.original_name || 'file'})</a></p>
      ) : null}
    </Modal>
  );
}

/* ------------------------------- result modal ---------------------------- */

function ResultModal({ test: t, onClose, onSaved }) {
  const [result, setResult] = useState(t.result || '');
  const [referenceRange, setReferenceRange] = useState(t.reference_range || '');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!result.trim() && !file) {
      setError('Add a result text or upload a report file before completing the test.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (file) {
        // multipart upload — server validates extension + 5 MB size cap (FR-09)
        const fd = new FormData();
        fd.set('status', 'completed');
        fd.set('result', result);
        fd.set('referenceRange', referenceRange);
        fd.set('file', file);
        await api(`/api/labs/${t.id}`, { method: 'PUT', formData: fd });
      } else {
        await api(`/api/labs/${t.id}`, { method: 'PUT', body: { status: 'completed', result, referenceRange } });
      }
      toast(`${t.test_code} completed and result saved`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Record result" sub={`${t.test_code} · ${t.test_name} · ${t.patient_name}`} onClose={onClose} size="wide"
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save & complete'}</button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <Field label="Result" required hint="Free-text findings; the test is marked completed when saved">
        <textarea className="textarea" value={result} onChange={(e) => setResult(e.target.value)} placeholder="e.g. WBC 9.2 x10^9/L — within normal range" autoFocus />
      </Field>
      <Field label="Reference range">
        <input className="input" value={referenceRange} onChange={(e) => setReferenceRange(e.target.value)} />
      </Field>
      <Field label="Report file" hint="PDF, image or document · max 5 MB · type and size are validated">
        <input ref={fileRef} className="input" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </Field>
      {file ? <div className="hint">Selected: {file.name} ({(file.size / 1024).toFixed(0)} KB)</div> : null}
    </Modal>
  );
}
