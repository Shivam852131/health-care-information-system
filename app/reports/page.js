'use client';

import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell.js';
import { PageHead, Loading } from '@/components/ui.js';
import { Kpi, BarChart, HBarCard, DonutCard } from '@/components/charts.js';
import { api, fmtDate, fmtMoney } from '@/lib/client.js';

const PERIODS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
];

function ReportsContent() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    api(`/api/reports?days=${days}`).then(setData).catch((e) => setError(e.message));
  }, [days]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!data) return <Loading label="Crunching numbers…" />;

  const { period, appointments: ap, patients: pt, labs: lb, billing: bl, clinical: cl } = data;

  return (
    <>
      <PageHead title="Reports & Analytics" sub={`Period: ${fmtDate(period.from)} → ${fmtDate(period.to)} · generated ${fmtDate(data.generatedAt)}`}>
        <div className="flex">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              className={`btn btn-sm ${days === p.days ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </PageHead>

      <div className="kpi-grid">
        <Kpi item={{ label: 'Appointments', value: ap.total, icon: '📅', tint: '#ecfdf9', foot: `${ap.completionRate}% completed` }} />
        <Kpi item={{ label: 'New patients', value: pt.newInPeriod, icon: '👥', tint: '#e5f4fd', foot: `${pt.active} active of ${pt.total}` }} />
        <Kpi item={{ label: 'Lab tests', value: lb.total, icon: '🧪', tint: '#f1eafd', foot: `${(lb.byStatus.find((x) => x.label === 'Completed') || {}).value || 0} completed` }} />
        <Kpi item={{ label: 'Billed', value: bl.billed, money: true, icon: '🧾', tint: '#fdf2e0', foot: `${bl.invoiceCount} invoice(s)` }} />
        <Kpi item={{ label: 'Collected', value: bl.collected, money: true, icon: '💰', tint: '#e8f8ee', foot: 'Payments in period' }} />
        <Kpi item={{ label: 'Outstanding', value: bl.outstanding, money: true, icon: '⏳', tint: '#fdecec', foot: 'Unpaid balances' }} />
      </div>

      <div className="grid grid-2 mt-20">
        <BarChart title="Revenue" sub={`Payments collected · last ${PERIODS.find((p) => p.days === days).label.toLowerCase()}`} data={bl.revenueSeries} />
        <BarChart title="Appointments" sub="Monthly volume" data={ap.series} variant="alt" />
      </div>

      <div className="grid grid-2 mt-20">
        <DonutCard title="Appointment outcomes" sub="Share of total in period" data={ap.byStatus} totalLabel="Appointments" />
        <HBarCard title="Busiest doctors" sub="Appointments in period" data={ap.byDoctor} />
      </div>

      <div className="grid grid-2 mt-20">
        <HBarCard title="Patient age groups" data={pt.ageBuckets} />
        <HBarCard title="Gender split" data={pt.gender} />
      </div>

      <div className="grid grid-2 mt-20">
        <HBarCard title="Top lab tests" data={lb.topTests} />
        <HBarCard title="Top services by revenue" data={bl.topServices} formatter={(v) => fmtMoney(v)} />
      </div>

      <div className="grid grid-3 mt-20">
        <div className="card center">
          <div className="card-body">
            <div className="t-sub">Prescriptions issued</div>
            <div style={{ fontSize: 26, fontWeight: 750 }}>{cl.prescriptions}</div>
          </div>
        </div>
        <div className="card center">
          <div className="card-body">
            <div className="t-sub">Consultations recorded</div>
            <div style={{ fontSize: 26, fontWeight: 750 }}>{cl.records}</div>
          </div>
        </div>
        <div className="card center">
          <div className="card-body">
            <div className="t-sub">Completion rate</div>
            <div style={{ fontSize: 26, fontWeight: 750 }}>{ap.completionRate}%</div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ReportsPage() {
  return (
    <AppShell title="Reports" crumb="Analytics · operations, clinical and finance (FR-10)">
      <ReportsContent />
    </AppShell>
  );
}
