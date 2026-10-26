'use client';

import { fmtDate, fmtMoney, drName } from '@/lib/client.js';

/** Printable invoice sheet — used by billing and the patient chart. */
export function InvoiceSheet({ inv, settings }) {
  return (
    <div className="invoice-sheet print-area">
      <div className="inv-head">
        <div>
          <div className="h-name">{settings?.hospital_name || 'MediCore HIS'}</div>
          <div className="h-sub">
            {settings?.hospital_address || ''}{settings?.hospital_phone ? ` · ${settings.hospital_phone}` : ''}
          </div>
        </div>
        <div className="h-sub">
          Invoice {inv.invoice_no}<br />
          {fmtDate(inv.issue_date)}{inv.due_date ? ` · due ${fmtDate(inv.due_date)}` : ''}
        </div>
      </div>
      <div className="mt-14">
        <b>{inv.patient_name}</b> <span className="t-sub mono">{inv.patient_code}</span>
        {inv.patient_phone ? <span className="t-sub"> · {inv.patient_phone}</span> : null}
      </div>
      <table className="med-table mt-14">
        <thead>
          <tr><th>#</th><th>Description</th><th>Qty</th><th>Unit</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
        </thead>
        <tbody>
          {(inv.items || []).map((it, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td className="m-name">{it.description}</td>
              <td>{it.qty}</td>
              <td>{fmtMoney(it.amount)}</td>
              <td style={{ textAlign: 'right' }}>{fmtMoney(it.qty * it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        <div className="t-row"><span>Subtotal</span><span>{fmtMoney(inv.subtotal)}</span></div>
        {inv.discount > 0 ? <div className="t-row muted"><span>Discount</span><span>− {fmtMoney(inv.discount)}</span></div> : null}
        <div className="t-row grand"><span>Total</span><span>{fmtMoney(inv.total)}</span></div>
        <div className="t-row"><span>Paid</span><span>{fmtMoney(inv.paid_amount)}</span></div>
        <div className="t-row">
          <span>Balance due</span>
          <span style={inv.balance > 0 ? { color: 'var(--danger)' } : undefined}>{fmtMoney(inv.balance)}</span>
        </div>
      </div>
      {inv.notes ? <p className="inline-note mt-14">{inv.notes}</p> : null}
    </div>
  );
}

/** Printable prescription sheet — used by prescriptions and the patient chart. */
export function RxSheet({ rx }) {
  return (
    <div className="rx-sheet print-area">
      <div className="rx-head">
        <div>
          <div className="h-name">{drName(rx.doctor_name)}</div>
          <div className="h-sub">{rx.specialization}{rx.qualification ? ` · ${rx.qualification}` : ''}</div>
        </div>
        <div className="h-sub">{fmtDate(rx.issued_date)}</div>
      </div>
      <div className="mt-14">
        <b>{rx.patient_name}</b> <span className="t-sub mono">{rx.patient_code}</span>
        {rx.blood_group ? <span className="t-sub"> · {rx.blood_group}</span> : null}
        {rx.patient_allergies && rx.patient_allergies !== 'None' ? (
          <span style={{ color: 'var(--danger)', fontWeight: 700 }}> · ⚠ Allergies: {rx.patient_allergies}</span>
        ) : null}
      </div>
      <div className="inline-note mt-8">Diagnosis: {rx.diagnosis}</div>
      <table className="med-table mt-14">
        <thead>
          <tr><th>#</th><th>Medicine</th><th>Strength</th><th>Dosage</th><th>Frequency</th><th>Duration</th></tr>
        </thead>
        <tbody>
          {(rx.medicines || []).map((m, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td className="m-name">{m.name}</td>
              <td>{m.strength || '—'}</td>
              <td>{m.dosage || '—'}</td>
              <td>{m.frequency || '—'}</td>
              <td>{m.duration || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rx.instructions ? <div className="mt-14"><div className="label">Instructions</div>{rx.instructions}</div> : null}
      {rx.follow_up ? <div className="mt-8"><span className="dim">Follow-up:</span> {rx.follow_up}</div> : null}
    </div>
  );
}
