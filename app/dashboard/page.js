'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell, { useApp } from '@/components/AppShell.js';
import { Loading, PageHead, EmptyState } from '@/components/ui.js';
import { Kpi, BarChart, HBarCard, ListCard } from '@/components/charts.js';
import {
  api,
  fmtMoney,
  fmtTime,
  fmtDate,
  timeAgo,
  statusLabel,
  STATUS_BADGE,
} from '@/lib/client.js';

/* --------------------------------- rows ---------------------------------- */

function StaffApptRow({ a, showDate = false }) {
  return (
    <div className="list-row" key={a.id}>
      <div className="time-chip">{a.time}</div>
      <div className="grow">
        <div className="r-title">
          {a.patient_name} <span className="t-sub mono">{a.patient_code}</span>
        </div>
        <div className="r-sub">
          {a.doctor_name} · {a.specialization}
          {a.reason ? ` · ${a.reason}` : ''}
        </div>
      </div>
      <div className="r-right">
        {showDate ? <div className="t-sub">{fmtDate(a.date)}</div> : null}
        <span className={`badge ${STATUS_BADGE[a.status] || 'badge-muted'}`}>{statusLabel(a.status)}</span>
      </div>
    </div>
  );
}

function PatientApptRow({ a }) {
  return (
    <div className="list-row" key={a.id}>
      <div className="time-chip">
        {fmtDate(a.date).replace(/ \d{4}$/, '')}
        <div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.85 }}>{a.time}</div>
      </div>
      <div className="grow">
        <div className="r-title">{a.doctor_name}</div>
        <div className="r-sub">
          {a.specialization}
          {a.reason ? ` · ${a.reason}` : ''}
        </div>
      </div>
      <div className="r-right">
        <span className={`badge ${STATUS_BADGE[a.status] || 'badge-muted'}`}>{statusLabel(a.status)}</span>
      </div>
    </div>
  );
}

/* -------------------------------- content -------------------------------- */

function DashboardContent() {
  const { user } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    api('/api/dashboard')
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="alert alert-danger">
        <span>⚠️</span>
        <span style={{ flex: 1 }}>{error}</span>
        <button className="btn btn-sm" type="button" onClick={load}>
          Retry
        </button>
      </div>
    );
  }
  if (!data) return <Loading label="Preparing your dashboard…" />;

  const { kpis = [], charts = {}, lists = {}, notes = [] } = data;
  const firstName = String(user.name || '')
    .split(' ')
    .find((part) => part && !/^(dr|mr|mrs|ms|prof)\.?$/i.test(part)) || 'there';

  return (
    <>
      <PageHead
        title={`Welcome back, ${firstName}`}
        sub={`Here is what is happening today · ${fmtDate(data.today)}`}
      >
        {['admin', 'receptionist'].includes(user.role) ? (
          <>
            <Link href="/patients?new=1" className="btn btn-ghost">
              ＋ Register patient
            </Link>
            <Link href="/appointments?new=1" className="btn btn-primary">
              📅 Book appointment
            </Link>
          </>
        ) : null}
        {user.role === 'doctor' ? (
          <Link href="/records?new=1" className="btn btn-primary">
            📝 Record consultation
          </Link>
        ) : null}
        {user.role === 'patient' ? (
          <Link href="/appointments?new=1" className="btn btn-primary">
            📅 Book an appointment
          </Link>
        ) : null}
        {user.role === 'lab' ? (
          <Link href="/labs" className="btn btn-primary">
            🔬 Open work queue
          </Link>
        ) : null}
      </PageHead>

      {notes.map((n) => (
        <div className="alert alert-warning" key={n}>
          <span>⚠️</span>
          <span>{n}</span>
        </div>
      ))}

      <div className="kpi-grid">
        {kpis.map((k) => (
          <Kpi key={k.label} item={k} />
        ))}
      </div>

      {/* ------------------------------- charts ------------------------------ */}
      {user.role === 'admin' ? (
        <div className="grid grid-2 mt-14">
          <BarChart title="Payments collected" sub="Last 6 months" data={charts.revenue} />
          <BarChart title="Appointments" sub="Last 7 days" data={charts.week} variant="alt" />
        </div>
      ) : null}

      {['doctor', 'receptionist'].includes(user.role) && charts.week ? (
        <div className="grid grid-2 mt-14">
          <BarChart title="Appointments" sub="Last 7 days" data={charts.week} variant="alt" />
          {user.role === 'doctor' ? (
            <ListCard
              title="Lab results pending"
              sub="Ordered for your patients"
              rows={lists.pendingLabs || []}
              href="/labs"
              emptyIcon="🧪"
              emptyTitle="All results are in"
              renderRow={(t) => (
                <div className="list-row" key={t.id}>
                  <div className="grow">
                    <div className="r-title">{t.test_name}</div>
                    <div className="r-sub">
                      {t.patient_name} <span className="mono">{t.patient_code}</span> · ordered {timeAgo(t.requested_at)}
                    </div>
                  </div>
                  <span className={`badge ${STATUS_BADGE[t.status] || ''}`}>{statusLabel(t.status)}</span>
                </div>
              )}
            />
          ) : (
            <ListCard
              title="Recently registered patients"
              rows={lists.recentPatients || []}
              href="/patients"
              emptyIcon="👥"
              emptyTitle="No patients yet"
              renderRow={(p) => (
                <div className="list-row" key={p.id}>
                  <div className="grow">
                    <div className="r-title">{p.name}</div>
                    <div className="r-sub mono">{p.patient_code}</div>
                  </div>
                  <div className="r-right">{p.phone || '—'}</div>
                </div>
              )}
            />
          )}
        </div>
      ) : null}

      {user.role === 'admin' ? (
        <>
          <div className="grid grid-2 mt-14">
            <HBarCard title="Appointment outcomes" sub="Last 30 days" data={charts.apptStatus} />
            <ListCard
              title="Today’s appointments"
              sub={`${(lists.todayAppointments || []).length} scheduled for ${fmtDate(data.today)}`}
              rows={lists.todayAppointments || []}
              href="/appointments"
              emptyIcon="📅"
              emptyTitle="No appointments today"
              renderRow={(a) => <StaffApptRow a={a} />}
            />
          </div>
          <div className="grid grid-2 mt-14">
            <ListCard
              title="Lab tests awaiting results"
              rows={lists.pendingLabs || []}
              href="/labs"
              emptyIcon="✅"
              emptyTitle="Lab queue is clear"
              renderRow={(t) => (
                <div className="list-row" key={t.id}>
                  <div className="grow">
                    <div className="r-title">{t.test_name}</div>
                    <div className="r-sub">
                      {t.patient_name} · ordered {timeAgo(t.requested_at)}
                    </div>
                  </div>
                  <span className={`badge ${STATUS_BADGE[t.status] || ''}`}>{statusLabel(t.status)}</span>
                </div>
              )}
            />
            <ListCard
              title="Recent activity"
              sub="Audit trail of important actions"
              rows={lists.activity || []}
              href="/admin"
              linkLabel="Audit log"
              emptyIcon="📜"
              emptyTitle="No activity recorded yet"
              renderRow={(log) => (
                <div className="list-row" key={log.id}>
                  <div className="grow">
                    <div className="r-title">{String(log.action).replace(/[._]/g, ' ')}</div>
                    <div className="r-sub">
                      {log.user_name || 'System'} {log.detail ? `· ${log.detail}` : ''}
                    </div>
                  </div>
                  <div className="r-right t-sub">{timeAgo(log.created_at)}</div>
                </div>
              )}
            />
          </div>
        </>
      ) : null}

      {/* ------------------------------- doctor ------------------------------ */}
      {user.role === 'doctor' ? (
        <div className="grid grid-2 mt-14">
          <ListCard
            title="Today’s schedule"
            sub={`${(lists.todayAppointments || []).length} appointments`}
            rows={lists.todayAppointments || []}
            href="/appointments"
            emptyIcon="🩺"
            emptyTitle="No appointments today"
            renderRow={(a) => (
              <div className="list-row" key={a.id}>
                <div className="time-chip">{a.time}</div>
                <div className="grow">
                  <div className="r-title">
                    {a.patient_name} <span className="t-sub mono">{a.patient_code}</span>
                  </div>
                  <div className="r-sub">{a.reason || 'Consultation'}</div>
                </div>
                <span className={`badge ${STATUS_BADGE[a.status] || ''}`}>{statusLabel(a.status)}</span>
              </div>
            )}
          />
          <ListCard
            title="Next up"
            sub="Upcoming appointments"
            rows={lists.upcoming || []}
            href="/appointments"
            emptyIcon="🗓"
            emptyTitle="No upcoming appointments"
            renderRow={(a) => (
              <div className="list-row" key={a.id}>
                <div className="grow">
                  <div className="r-title">
                    {a.patient_name} <span className="t-sub mono">{a.patient_code}</span>
                  </div>
                  <div className="r-sub">
                    {fmtDate(a.date)} · {a.time} · {a.reason || 'Consultation'}
                  </div>
                </div>
                <span className="pill">{a.specialization}</span>
              </div>
            )}
          />
        </div>
      ) : null}

      {user.role === 'doctor' && (lists.recentRecords || []).length ? (
        <div className="grid grid-2 mt-14">
          <ListCard
            title="Consultations you recorded"
            rows={lists.recentRecords || []}
            href="/records"
            emptyIcon="📝"
            renderRow={(r) => (
              <div className="list-row" key={r.id}>
                <div className="grow">
                  <div className="r-title">{r.diagnosis}</div>
                  <div className="r-sub">
                    {r.patient_name} · {fmtDate(r.visit_date)}
                  </div>
                </div>
                <span className="pill mono">{r.record_code}</span>
              </div>
            )}
          />
          <div className="card">
            <div className="card-head">
              <div>
                <h3>Quick actions</h3>
                <div className="sub">Common clinical tasks</div>
              </div>
            </div>
            <div className="card-body flex">
              <Link href="/records?new=1" className="btn btn-primary">📝 New consultation note</Link>
              <Link href="/prescriptions?new=1" className="btn btn-soft">💊 Write prescription</Link>
              <Link href="/labs?new=1" className="btn btn-soft">🧪 Order a lab test</Link>
              <Link href="/patients" className="btn btn-ghost">👥 Find a patient</Link>
            </div>
          </div>
        </div>
      ) : null}

      {/* ------------------------------- patient ----------------------------- */}
      {user.role === 'patient' ? (
        <>
          <div className="grid grid-2 mt-14">
            <div className="card">
              <div className="card-head">
                <div>
                  <h3>Next appointment</h3>
                  <div className="sub">Your upcoming visit</div>
                </div>
                <div className="right">
                  <Link href="/appointments" className="btn btn-soft btn-sm">
                    All appointments →
                  </Link>
                </div>
              </div>
              <div className="card-body">
                {lists.nextAppointment ? (
                  <>
                    <div className="flex" style={{ gap: 14 }}>
                      <div className="time-chip" style={{ minWidth: 96, fontSize: 14 }}>
                        {lists.nextAppointment.time}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 750, fontSize: 16 }}>{lists.nextAppointment.doctor_name}</div>
                        <div className="t-sub">
                          {lists.nextAppointment.specialization} · {fmtDate(lists.nextAppointment.date)}
                        </div>
                      </div>
                      <span className={`badge ${STATUS_BADGE[lists.nextAppointment.status] || 'badge-info'}`}>
                        {statusLabel(lists.nextAppointment.status)}
                      </span>
                    </div>
                    <div className="kv mt-14">
                      <span className="k">Reason</span>
                      <span className="v">{lists.nextAppointment.reason || 'General consultation'}</span>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon="📅"
                    title="No upcoming appointment"
                    sub="Book a visit with one of our doctors."
                    action={
                      <Link href="/appointments?new=1" className="btn btn-primary btn-sm">
                        Book now
                      </Link>
                    }
                  />
                )}
              </div>
            </div>

            <ListCard
              title="Active prescriptions"
              rows={lists.prescriptions || []}
              href="/prescriptions"
              linkLabel="All"
              emptyIcon="💊"
              emptyTitle="No active prescriptions"
              renderRow={(rx) => (
                <div className="list-row" key={rx.id}>
                  <div className="grow">
                    <div className="r-title">{rx.diagnosis}</div>
                    <div className="r-sub">
                      {rx.doctor_name} · {fmtDate(rx.issued_date)}
                    </div>
                  </div>
                  <span className="pill mono">{rx.rx_code}</span>
                </div>
              )}
            />
          </div>

          <div className="grid grid-2 mt-14">
            <ListCard
              title="Recent lab reports"
              rows={lists.recentLabs || []}
              href="/labs"
              linkLabel="All"
              emptyIcon="🧪"
              emptyTitle="No lab reports yet"
              renderRow={(t) => (
                <div className="list-row" key={t.id}>
                  <div className="grow">
                    <div className="r-title">{t.test_name}</div>
                    <div className="r-sub">{fmtDate(t.requested_at)}</div>
                  </div>
                  <span className={`badge ${STATUS_BADGE[t.status] || ''}`}>{statusLabel(t.status)}</span>
                </div>
              )}
            />
            <ListCard
              title="Medical history"
              rows={lists.recentRecords || []}
              href="/records"
              linkLabel="Full history"
              emptyIcon="📋"
              emptyTitle="No consultations recorded yet"
              renderRow={(r) => (
                <div className="list-row" key={r.id}>
                  <div className="grow">
                    <div className="r-title">{r.diagnosis}</div>
                    <div className="r-sub">
                      {r.doctor_name || 'Doctor'} · {fmtDate(r.visit_date)}
                    </div>
                  </div>
                </div>
              )}
            />
          </div>
        </>
      ) : null}

      {/* ---------------------------- receptionist --------------------------- */}
      {user.role === 'receptionist' ? (
        <>
          <div className="grid grid-2 mt-14">
            <ListCard
              title="Today’s appointments"
              sub={`${(lists.todayAppointments || []).length} scheduled`}
              rows={lists.todayAppointments || []}
              href="/appointments"
              emptyIcon="📅"
              emptyTitle="No appointments today"
              renderRow={(a) => <StaffApptRow a={a} />}
            />
            <div className="card">
              <div className="card-head">
                <div>
                  <h3>Front desk actions</h3>
                  <div className="sub">Daily shortcuts</div>
                </div>
              </div>
              <div className="card-body flex" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                <Link href="/patients?new=1" className="btn btn-primary btn-block">＋ Register a new patient</Link>
                <Link href="/appointments?new=1" className="btn btn-soft btn-block">📅 Book an appointment</Link>
                <Link href="/billing?new=1" className="btn btn-soft btn-block">🧾 Create an invoice</Link>
                <Link href="/patients" className="btn btn-ghost btn-block">🔍 Search patient records</Link>
              </div>
            </div>
          </div>
          <div className="grid grid-2 mt-14">
            <ListCard
              title="Recently registered"
              rows={lists.recentPatients || []}
              href="/patients"
              emptyIcon="👥"
              emptyTitle="No patients registered yet"
              renderRow={(p) => (
                <div className="list-row" key={p.id}>
                  <div className="grow">
                    <div className="r-title">{p.name}</div>
                    <div className="r-sub mono">{p.patient_code}</div>
                  </div>
                  <div className="r-right">{p.phone || '—'}</div>
                </div>
              )}
            />
          </div>
        </>
      ) : null}

      {/* -------------------------------- lab -------------------------------- */}
      {user.role === 'lab' ? (
        <div className="grid grid-2 mt-14">
          <ListCard
            title="Work queue"
            sub="Tests waiting for results"
            rows={lists.queue || []}
            href="/labs"
            linkLabel="Open lab module"
            emptyIcon="✅"
            emptyTitle="Queue is clear"
            renderRow={(t) => (
              <div className="list-row" key={t.id}>
                <div className="grow">
                  <div className="r-title">{t.test_name}</div>
                  <div className="r-sub">
                    {t.patient_name} <span className="mono">{t.patient_code}</span> · {t.category} · {timeAgo(t.requested_at)}
                  </div>
                </div>
                <span className={`badge ${STATUS_BADGE[t.status] || ''}`}>{statusLabel(t.status)}</span>
              </div>
            )}
          />
          <ListCard
            title="Recently completed"
            rows={lists.recentCompleted || []}
            href="/labs"
            emptyIcon="📁"
            emptyTitle="No reports uploaded yet"
            renderRow={(t) => (
              <div className="list-row" key={t.id}>
                <div className="grow">
                  <div className="r-title">{t.test_name}</div>
                  <div className="r-sub">
                    {t.patient_name} · {fmtDate(t.completed_at)}
                  </div>
                </div>
                {t.file_name ? <span className="badge badge-brand no-dot">📎 file</span> : null}
              </div>
            )}
          />
        </div>
      ) : null}
    </>
  );
}

export default function DashboardPage() {
  return (
    <AppShell title="Dashboard" crumb="Overview · real-time summary">
      <DashboardContent />
    </AppShell>
  );
}
