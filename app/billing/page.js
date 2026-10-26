'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell, { useApp } from '@/components/AppShell.js';
import { PageHead, EmptyState, Loading, Modal, Field } from '@/components/ui.js';
import { DataTable, Toolbar, SearchInput, FilterSelect } from '@/components/Table.js';
import { PatientSelect } from '@/components/pickers.js';
import { InvoiceSheet } from '@/components/print.js';
import { Kpi } from '@/components/charts.js';
import { api, toast, toastError, fmtDate, fmtMoney, todayISO, statusLabel, STATUS_BADGE, can } from '@/lib/client.js';

const STATUSES = ['pending', 'partial', 'paid'];
const METHODS = ['cash', 'card', 'upi', 'insurance', 'cheque', 'bank_transfer'];

function BillingContent() {
  const { user } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [newOpen, setNewOpen] = useState(false);
  const [viewing, setViewing] = useState(null); // invoice id

  const mayCreate = can(user, 'invoice:create');
  const mayPay = can(user, 'payment:record');
  const isPatient = user.role === 'patient';

  const load = useCallback(() => {
    setError('');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status !== 'all') params.set('status', status);
    api(`/api/invoices?${params}`).then(setData).catch((e) => setError(e.message));
  }, [q, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1' && mayCreate) setNewOpen(true);
  }, [mayCreate]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!data) return <Loading label="Loading invoices…" />;

  const rows = data.invoices || [];
  const s = data.summary || {};

  return (
    <>
      <PageHead title={isPatient ? 'My bills' : 'Billing'} sub="Invoices, payments and receipts (FR-06)">
        {mayCreate ? (
          <Link href="/billing?new=1" className="btn btn-primary" onClick={(e) => { e.preventDefault(); setNewOpen(true); }}>
            🧾 New invoice
          </Link>
        ) : null}
      </PageHead>

      {!isPatient ? (
        <div className="kpi-grid mb-0">
          <Kpi item={{ label: 'Billed (all time)', value: s.billed, money: true, icon: '🧾', tint: '#e5f4fd', foot: `${rows.length} invoice(s) listed` }} />
          <Kpi item={{ label: 'Collected', value: s.collected, money: true, icon: '💰', tint: '#e8f8ee', foot: 'Payments received' }} />
          <Kpi item={{ label: 'Outstanding', value: s.outstanding, money: true, icon: '⏳', tint: '#fdf2e0', foot: `${s.pending || 0} pending · ${s.partial || 0} partial` }} />
        </div>
      ) : null}

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search invoice number or patient…" />
        <FilterSelect value={status} onChange={setStatus} label="Status"
          options={[{ value: 'all', label: 'All statuses' }, ...STATUSES.map((st) => ({ value: st, label: statusLabel(st) }))]} />
      </Toolbar>

      <DataTable
        columns={[
          { key: 'invoice_no', label: 'Invoice', cls: 'mono' },
          { key: 'issue_date', label: 'Issued', cls: 'nowrap', render: (i) => fmtDate(i.issue_date) },
          {
            key: 'patient_name',
            label: 'Patient',
            render: (i) => (
              <div>
                <div className="t-strong">{i.patient_name}</div>
                <div className="t-sub mono">{i.patient_code}</div>
              </div>
            ),
          },
          { key: 'total', label: 'Total', cls: 'num', render: (i) => fmtMoney(i.total) },
          { key: 'paid_amount', label: 'Paid', cls: 'num', render: (i) => fmtMoney(i.paid_amount) },
          {
            key: 'balance',
            label: 'Due',
            cls: 'num',
            render: (i) => (
              <span style={i.balance > 0 ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>{fmtMoney(i.balance)}</span>
            ),
          },
          { key: 'status', label: 'Status', render: (i) => <span className={`badge ${STATUS_BADGE[i.status] === 'badge-success' ? 'badge-success' : i.status === 'paid' ? 'badge-success' : i.status === 'partial' ? 'badge-warning' : 'badge-info'}`}>{statusLabel(i.status)}</span> },
          {
            key: '_actions',
            label: '',
            align: 'right',
            render: (i) => (
              <div className="flex" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setViewing(i.id)}>View</button>
                {mayPay && i.balance > 0 ? (
                  <button className="btn btn-primary btn-sm" onClick={() => setViewing(i.id)}>Record payment</button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={rows}
        keyFn={(i) => i.id}
        pageSize={20}
        rowLabel="invoice"
        empty={
          <EmptyState
            icon="🧾"
            title="No invoices"
            sub={q || status !== 'all' ? 'Try different filters.' : 'Create the first invoice to start billing.'}
            action={mayCreate ? <button className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>New invoice</button> : null}
          />
        }
      />

      {newOpen ? (
        <NewInvoiceModal
          defaultPatient={Number(new URLSearchParams(window.location.search).get('patient')) || null}
          onClose={() => setNewOpen(false)}
          onSaved={() => { setNewOpen(false); load(); }}
        />
      ) : null}
      {viewing ? (
        <InvoiceModal invoiceId={viewing} onClose={() => setViewing(null)} onChanged={() => { load(); }} />
      ) : null}
    </>
  );
}

export default function BillingPage() {
  return (
    <AppShell title="Billing" crumb="Finance · invoices and payments">
      <BillingContent />
    </AppShell>
  );
}

/* ---------------------------- new invoice modal --------------------------- */

const EMPTY_ITEM = { description: '', qty: 1, amount: '' };

function NewInvoiceModal({ defaultPatient, onClose, onSaved }) {
  const [patientId, setPatientId] = useState(defaultPatient);
  const [issueDate, setIssueDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState([{ ...EMPTY_ITEM }, { ...EMPTY_ITEM }]);
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setItem = (i, k) => (e) => {
    const next = [...items];
    next[i] = { ...next[i], [k]: e.target.value };
    setItems(next);
  };
  const addItem = () => items.length < 40 && setItems([...items, { ...EMPTY_ITEM }]);
  const removeItem = (i) => items.length > 1 && setItems(items.filter((_, idx) => idx !== i));

  const subtotal = items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.amount) || 0), 0);
  const total = Math.max(0, subtotal - (Number(discount) || 0));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = {
        patientId,
        issueDate,
        dueDate: dueDate || undefined,
        discount: Number(discount) || 0,
        notes,
        items: items
          .filter((it) => it.description.trim())
          .map((it) => ({ description: it.description, qty: Number(it.qty), amount: Number(it.amount) })),
      };
      const d = await api('/api/invoices', { method: 'POST', body });
      toast(`Invoice ${d.invoice.invoice_no} created — ${fmtMoney(d.invoice.total)}`, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New invoice" sub="Totals are computed and validated on the server" onClose={onClose} size="wide" onSubmit={submit}
      footer={
        <>
          <span className="right-gap t-strong">Total: {fmtMoney(total)}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !patientId}>{saving ? 'Saving…' : 'Create invoice'}</button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <PatientSelect value={patientId} onChange={setPatientId} required />
      <div className="form-row">
        <Field label="Issue date" required><input className="input" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} max={todayISO()} /></Field>
        <Field label="Due date"><input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
      </div>

      <div className="label">Line items <span className="dim">({items.length}/40)</span></div>
      <div className="item-row" style={{ marginBottom: 4 }}>
        <span className="t-sub">Description</span><span className="t-sub">Qty</span><span className="t-sub">Unit amount</span><span />
      </div>
      {items.map((it, i) => (
        <div className="item-row" key={i}>
          <input className="input" placeholder="Consultation fee" value={it.description} onChange={setItem(i, 'description')} aria-label={`Item ${i + 1} description`} />
          <input className="input" type="number" min="1" max="999" value={it.qty} onChange={setItem(i, 'qty')} aria-label="Quantity" />
          <input className="input" type="number" min="0" step="0.01" value={it.amount} onChange={setItem(i, 'amount')} aria-label="Unit amount" />
          <button type="button" className="icon-btn" onClick={() => removeItem(i)} disabled={items.length === 1} aria-label="Remove item">✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-soft btn-sm mt-8" onClick={addItem} disabled={items.length >= 40}>＋ Add item</button>

      <div className="form-row mt-14">
        <Field label="Discount" hint={`Subtotal ${fmtMoney(subtotal)} · max ${fmtMoney(subtotal)}`}>
          <input className="input" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </Field>
        <Field label="Notes"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/* ------------------------------ invoice modal ----------------------------- */

function InvoiceModal({ invoiceId, onClose, onChanged }) {
  const { user } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [payOpen, setPayOpen] = useState(false);

  const load = useCallback(() => {
    api(`/api/invoices/${invoiceId}`).then(setData).catch((e) => setError(e.message));
  }, [invoiceId]);
  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <Modal title="Invoice" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
        <div className="alert alert-danger">{error}</div>
      </Modal>
    );
  }
  if (!data) return <Modal title="Invoice" onClose={onClose}><Loading label="Loading invoice…" /></Modal>;

  const { invoice: inv, settings, canPay } = data;

  return (
    <>
      <Modal title={`Invoice ${inv.invoice_no}`} sub={`${inv.patient_name} · ${fmtDate(inv.issue_date)}`} onClose={onClose} size="wide"
        footer={
          <>
            <span className="right-gap">
              <span className={`badge ${inv.status === 'paid' ? 'badge-success' : inv.status === 'partial' ? 'badge-warning' : 'badge-info'}`}>{statusLabel(inv.status)}</span>
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖨 Print</button>
            {canPay ? (
              <button type="button" className="btn btn-primary" onClick={() => setPayOpen(true)}>Record payment</button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          </>
        }>
        <InvoiceSheet inv={inv} settings={settings} />

        {(inv.payments || []).length ? (
          <>
            <div className="label mt-20">Payment history</div>
            <div className="list">
              {inv.payments.map((p) => (
                <div className="list-row" key={p.id}>
                  <div className="grow">
                    <div className="r-title">{fmtMoney(p.amount)} · {statusLabel(p.method)}</div>
                    <div className="r-sub">{p.payment_code}{p.reference ? ` · ref ${p.reference}` : ''}</div>
                  </div>
                  <div className="r-right t-sub">{fmtDate(p.paid_at)}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Modal>

      {payOpen ? (
        <PaymentModal invoice={inv} onClose={() => setPayOpen(false)}
          onPaid={() => { setPayOpen(false); load(); onChanged(); }} />
      ) : null}
    </>
  );
}

/* ----------------------------- payment modal ------------------------------ */

function PaymentModal({ invoice: inv, onClose, onPaid }) {
  const [amount, setAmount] = useState(String(inv.balance));
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const d = await api('/api/payments', {
        method: 'POST',
        body: { invoiceId: inv.id, amount: Number(amount), method, reference },
      });
      toast(`Payment of ${fmtMoney(d.payment.amount)} recorded — invoice now ${d.invoice.status}`, 'success');
      onPaid();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Record payment" sub={`${inv.invoice_no} · balance ${fmtMoney(inv.balance)}`} onClose={onClose} onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !(Number(amount) > 0)}>
            {saving ? 'Saving…' : `Pay ${fmtMoney(Number(amount) || 0)}`}
          </button>
        </>
      }>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <Field label="Amount" required hint={`Outstanding balance is ${fmtMoney(inv.balance)} — overpayment is rejected`}>
        <input className="input" type="number" min="0.01" step="0.01" max={inv.balance} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </Field>
      <Field label="Method" required>
        <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.map((m) => <option key={m} value={m}>{statusLabel(m)}</option>)}
        </select>
      </Field>
      <Field label="Transaction reference" hint="Card / UPI / cheque reference (optional)">
        <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
      </Field>
    </Modal>
  );
}
