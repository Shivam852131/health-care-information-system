'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, toast } from '@/lib/client.js';
import { Field, Toaster } from '@/components/ui.js';
import { Icon } from '@/components/icons.js';
import { useTheme } from '@/lib/theme.js';

const DEMO_ACCOUNTS = [
  { label: 'Administrator', email: 'admin@demo.local', icon: '⚙️' },
  { label: 'Doctor', email: 'priya@demo.local', icon: '🩺' },
  { label: 'Patient', email: 'aarav@demo.local', icon: '🧑' },
  { label: 'Lab Staff', email: 'lab@demo.local', icon: '🧪' },
  { label: 'Receptionist', email: 'reception@demo.local', icon: '🧑‍💼' },
];

const FEATURES = [
  ['🛡️', 'Role-based access control with full audit logging'],
  ['📄', 'Digital patient records, histories and diagnoses'],
  ['📅', 'Conflict-free appointment booking and schedules'],
  ['🧪', 'Laboratory reports, prescriptions and billing'],
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [activeChip, setActiveChip] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const theme = useTheme();

  // Already signed in → go straight to the dashboard.
  useEffect(() => {
    let alive = true;
    api('/api/auth/me')
      .then(() => alive && router.replace('/dashboard'))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [router]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }
    setBusy(true);
    try {
      const res = await api('/api/auth/login', { body: { email: email.trim(), password } });
      const first = String(res.user.name || '').split(' ')[0];
      toast(`Welcome back, ${first}.`, 'success');
      router.replace('/dashboard');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const useDemo = (account) => {
    setEmail(account.email);
    setPassword('demo123');
    setActiveChip(account.email);
    setError('');
  };

  return (
    <div className="login">
      <div className="login-hero">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">MediCore HIS</div>
            <div className="brand-sub">Healthcare Information System</div>
          </div>
        </div>

        <h1>Every record, appointment and report — in one secure place.</h1>
        <p className="lead">
          The centralised platform that replaces paper files: register patients, manage schedules,
          record consultations, publish lab reports and generate accurate bills.
        </p>

        <div className="feats">
          {FEATURES.map(([icon, text]) => (
            <div className="feat" key={text}>
              <span className="f-ico">{icon}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>

        <div className="foot">College project build · PRD v1.0 · Demo data stays on this machine</div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <h2>Sign in</h2>
              <p className="sub">Use your authorised account to access the healthcare information system.</p>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={theme.toggle}
              aria-label={theme.effective === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme.effective === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <Icon name={theme.effective === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
          </div>

          <div className="card card-pad">
            <form onSubmit={submit} noValidate>
              {error ? (
                <div className="alert alert-danger" role="alert">
                  <span>⛔</span>
                  <span>{error}</span>
                </div>
              ) : null}

              <Field label="Email address" id="email" required>
                <input
                  id="email"
                  className="input"
                  type="email"
                  autoComplete="username"
                  placeholder="you@hospital.org"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setActiveChip('');
                  }}
                  autoFocus
                />
              </Field>

              <Field label="Password" id="password" required>
                <div className="pw-wrap">
                  <input
                    id="password"
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="pw-eye"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={16} />
                  </button>
                </div>
              </Field>

              <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
                {busy ? <span className="spinner sm btn-spin" /> : null}
                {busy ? 'Signing in…' : 'Sign in securely'}
              </button>
            </form>
          </div>

          <div className="demo-box">
            <div className="d-title">Demo accounts — click to fill (password: demo123)</div>
            <div className="demo-chips">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  className={`chip ${activeChip === a.email ? 'on' : ''}`}
                  onClick={() => useDemo(a)}
                >
                  {a.icon} {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Toaster />
    </div>
  );
}
