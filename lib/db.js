import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './crypto.js';
import { buildInsert, todayISO, safeJson } from './util.js';

export const DATA_DIR = path.join(process.cwd(), 'data');
export const DB_PATH = path.join(DATA_DIR, 'his.db');
export const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

/* ------------------------------- SCHEMA ------------------------------- */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  linked_patient_id INTEGER,
  linked_doctor_id INTEGER,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_code TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  dob TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  blood_group TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  allergies TEXT DEFAULT 'None',
  emergency_contact TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_code TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  specialization TEXT NOT NULL,
  qualification TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  fee REAL NOT NULL DEFAULT 500,
  availability TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_code TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  reason TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
-- DB-level guard: a doctor can never hold two live bookings in the same slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_appt_slot ON appointments(doctor_id, date, time) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);

CREATE TABLE IF NOT EXISTS medical_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_code TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id INTEGER REFERENCES doctors(id) ON DELETE SET NULL,
  visit_date TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  treatment TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_records_patient ON medical_records(patient_id);

CREATE TABLE IF NOT EXISTS lab_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_code TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  status TEXT NOT NULL DEFAULT 'requested',
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  result TEXT DEFAULT '',
  reference_range TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  original_name TEXT DEFAULT '',
  file_type TEXT DEFAULT '',
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_patient ON lab_tests(patient_id);

CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rx_code TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  diagnosis TEXT DEFAULT '',
  medicines TEXT NOT NULL DEFAULT '[]',
  instructions TEXT DEFAULT '',
  follow_up TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  issued_date TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions(patient_id);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  items TEXT NOT NULL DEFAULT '[]',
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  issue_date TEXT NOT NULL,
  due_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoice_patient ON invoices(patient_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_code TEXT NOT NULL UNIQUE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  reference TEXT DEFAULT '',
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT DEFAULT '',
  user_role TEXT DEFAULT '',
  action TEXT NOT NULL,
  entity TEXT DEFAULT '',
  entity_id TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/* ------------------------------ CONNECTION ----------------------------- */

function open() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  seedIfEmpty(db);
  return db;
}

export function getDb() {
  if (!globalThis.__hisDb) globalThis.__hisDb = open();
  return globalThis.__hisDb;
}

export function insert(db, table, obj) {
  const { sql, params } = buildInsert(table, obj);
  const r = db.prepare(sql).run(...params);
  return Number(r.lastInsertRowid);
}

export function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/* -------------------------------- SEED -------------------------------- */

function seedIfEmpty(db) {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (c > 0) return;
  seed(db);
}

function seed(db) {
  const d = todayISO;
  const ins = (table, obj) => insert(db, table, obj);

  /* --- users --------------------------------------------------------- */
  const DEMO_PASSWORD = hashPassword('demo123');
  const users = {};
  const mkUser = (u) => {
    const id = ins('users', { ...u, password_hash: DEMO_PASSWORD, status: 'active', created_at: `${d(-180)} 09:00:00` });
    users[u.email] = id;
    return id;
  };

  mkUser({ name: 'Rohan Deshmukh', email: 'admin@demo.local', phone: '+91 98200 11001', role: 'admin' });
  mkUser({ name: 'Kavita Rao', email: 'lab@demo.local', phone: '+91 98200 11002', role: 'lab' });
  mkUser({ name: 'Sneha Kulkarni', email: 'reception@demo.local', phone: '+91 98200 11003', role: 'receptionist' });

  /* --- doctors ------------------------------------------------------- */
  const openHours = {
    mon: ['09:00', '17:00'], tue: ['09:00', '17:00'], wed: ['09:00', '17:00'],
    thu: ['09:00', '17:00'], fri: ['09:00', '17:00'], sat: ['09:00', '13:00'], sun: null,
  };
  const evening = {
    mon: ['10:00', '18:00'], tue: ['10:00', '18:00'], wed: ['10:00', '18:00'],
    thu: ['10:00', '18:00'], fri: ['10:00', '18:00'], sat: ['10:00', '14:00'], sun: null,
  };
  const halfDay = {
    mon: ['09:00', '14:00'], tue: ['09:00', '14:00'], wed: ['09:00', '14:00'],
    thu: ['09:00', '14:00'], fri: ['09:00', '14:00'], sat: null, sun: null,
  };
  const doctorDefs = [
    ['Dr. Priya Sharma', 'Cardiology', 'MD, DM (Cardiology)', 800, openHours, 'priya@demo.local', '+91 98200 22001'],
    ['Dr. Rajesh Iyer', 'Orthopedics', 'MS (Orthopedics)', 700, evening, 'rajesh@demo.local', '+91 98200 22002'],
    ['Dr. Meera Nair', 'Pediatrics', 'MD (Pediatrics)', 600, openHours, 'meera@demo.local', '+91 98200 22003'],
    ['Dr. Arjun Kapoor', 'Dermatology', 'MD (Dermatology)', 650, halfDay, 'arjun@demo.local', '+91 98200 22004'],
    ['Dr. Sana Qureshi', 'General Medicine', 'MBBS, MD', 500, openHours, 'sana@demo.local', '+91 98200 22005'],
  ];
  const doctors = [];
  doctorDefs.forEach((row, i) => {
    const [name, specialization, qualification, fee, availability, email, phone] = row;
    const userId = mkUser({ name, email, phone, role: 'doctor' });
    const id = ins('doctors', {
      doctor_code: `DR-${String(i + 1).padStart(4, '0')}`,
      user_id: userId, name, specialization, qualification, phone, email, fee,
      availability: JSON.stringify(availability), status: 'active', created_at: `${d(-170)} 09:00:00`,
    });
    db.prepare('UPDATE users SET linked_doctor_id = ? WHERE id = ?').run(id, userId);
    doctors.push(id);
  });

  /* --- patients ------------------------------------------------------ */
  const patientDefs = [
    ['Aarav Mehta', '1994-03-12', 'Male', 'B+', '+91 99200 33001', 'aarav@demo.local', 'Penicillin', '12 MG Road, Pune', 'Rita Mehta +91 99200 33050'],
    ['Diya Singh', '1988-07-25', 'Female', 'O+', '+91 99200 33002', '', 'None', '44 Anna Salai, Chennai', 'Amit Singh +91 99200 33051'],
    ['Karan Patel', '2001-01-08', 'Male', 'A+', '+91 99200 33003', '', 'Dust allergy', '9 CG Road, Ahmedabad', 'Meena Patel +91 99200 33052'],
    ['Ishita Rao', '1996-11-30', 'Female', 'AB+', '+91 99200 33004', '', 'None', '71 MG Road, Bengaluru', 'Suresh Rao +91 99200 33053'],
    ['Vikram Chouhan', '1975-05-19', 'Male', 'B-', '+91 99200 33005', '', 'Sulfa drugs', '5 Station Road, Indore', 'Anita Chouhan +91 99200 33054'],
    ['Neha Gupta', '1990-09-02', 'Female', 'O-', '+91 99200 33006', '', 'None', '23 MG Road, Delhi', 'Ravi Gupta +91 99200 33055'],
    ['Rohit Verma', '1968-12-15', 'Male', 'A-', '+91 99200 33007', '', 'Latex', '8 Park Street, Kolkata', 'Sonia Verma +91 99200 33056'],
    ['Sunita Devi', '1982-06-04', 'Female', 'B+', '+91 99200 33008', '', 'None', '17 Gandhi Nagar, Jaipur', 'Mohan Devi +91 99200 33057'],
  ];
  const patients = [];
  patientDefs.forEach((row, i) => {
    const [name, dob, gender, blood_group, phone, email, allergies, address, emergency_contact] = row;
    let userId = null;
    if (email) userId = mkUser({ name, email, phone, role: 'patient' });
    const id = ins('patients', {
      patient_code: `PT-${String(i + 1).padStart(4, '0')}`,
      user_id: userId, name, dob, gender, blood_group, phone, email,
      address, allergies, emergency_contact, notes: '', status: 'active',
      created_at: `${d(-150)} 10:00:00`,
    });
    if (userId) db.prepare('UPDATE users SET linked_patient_id = ? WHERE id = ?').run(id, userId);
    patients.push(id);
  });

  /* --- appointments --------------------------------------------------- */
  const dayIdx = (offset) => (new Date(d(offset) + 'T00:00:00').getDay() + 6) % 7; // 0 = Monday
  const apptDefs = [
    // [offset, time, patientIdx, doctorIdx, reason, status]
    [-6, '09:30', 0, 0, 'Chest pain and palpitations', 'completed'],
    [-6, '11:00', 1, 4, 'Persistent cough for 5 days', 'completed'],
    [-5, '10:00', 2, 1, 'Knee pain after sports injury', 'completed'],
    [-4, '09:00', 4, 0, 'Follow-up: hypertension review', 'completed'],
    [-3, '14:30', 5, 3, 'Skin rash on both arms', 'completed'],
    [-2, '15:00', 3, 4, 'Migraine and light sensitivity', 'cancelled'],
    [-1, '10:30', 6, 1, 'Lower back pain', 'completed'],
    [-1, '12:00', 7, 2, 'Child vaccination schedule', 'no_show'],
    [0, '09:30', 0, 0, 'ECG review and medication check', 'scheduled'],
    [0, '10:30', 3, 4, 'Fever with body ache', 'scheduled'],
    [0, '11:30', 5, 3, 'Allergy patch test consultation', 'scheduled'],
    [1, '09:00', 2, 1, 'Knee X-ray review', 'scheduled'],
    [1, '14:00', 1, 0, 'Post-operative cardiac check-up', 'scheduled'],
    [2, '10:00', 6, 2, 'Paediatric growth review', 'scheduled'],
    [3, '11:00', 4, 0, 'Blood pressure monitoring', 'scheduled'],
    [4, '15:30', 7, 3, 'Follow-up: dermatitis', 'scheduled'],
  ];
  const apptIds = [];
  apptDefs.forEach((row, i) => {
    let [offset, time, pIdx, dIdx, reason, status] = row;
    const date = d(offset);
    const dow = dayIdx(offset);
    const avail = safeJson(doctors ? db.prepare('SELECT availability FROM doctors WHERE id = ?').get(doctors[dIdx]).availability : '{}', {});
    const dayKey = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][dow];
    const window = avail[dayKey];
    if (!window || time < window[0] || time >= window[1]) {
      time = window ? window[0] : '10:00';
    }
    const id = ins('appointments', {
      appointment_code: `AP-${String(i + 1).padStart(4, '0')}`,
      patient_id: patients[pIdx], doctor_id: doctors[dIdx], date, time, reason,
      notes: '', status, created_by: users['reception@demo.local'],
      created_at: `${d(offset - 3)} 09:15:00`,
    });
    if (status !== 'scheduled') db.prepare('UPDATE appointments SET updated_at = ? WHERE id = ?').run(`${date} ${time}:00`, id);
    apptIds.push(id);
  });

  /* --- medical records ------------------------------------------------ */
  const recordDefs = [
    [0, 0, -6, 'Stable angina, NYHA class II', 'Aspirin 75mg once daily; Atorvastatin 20mg at night; lifestyle advice', 'ECG normal sinus rhythm. Echo shows EF 58%.'],
    [1, 4, -6, 'Acute viral bronchitis', 'Steam inhalation, Paracetamol 500mg TDS x 3 days, plenty of fluids', 'Chest clear on auscultation. No antibiotics required.'],
    [2, 1, -5, 'Meniscus tear, right knee', 'Ice compression, knee brace, Tab Diclofenac 50mg BD x 5 days', 'MRI advised. Weight-bearing as tolerated.'],
    [4, 0, -4, 'Essential hypertension (controlled)', 'Tab Telmisartan 40mg once daily; low-sodium diet', 'BP 138/86. Review after 4 weeks.'],
    [5, 3, -3, 'Allergic contact dermatitis', 'Topical hydrocortisloride 1% BD; Cetirizine 10mg at night', 'Avoid suspected soap irritant. Review in 10 days.'],
    [6, 1, -1, 'Lumbar muscle strain', 'Hot fomentation; Tab Naproxen 250mg BD x 5 days; physiotherapy referral', 'No neurological deficit. Disc pathology ruled out clinically.'],
    [0, 0, -30, 'Hypertension — first consultation', 'Lifestyle modification; Tab Telmisartan 20mg once daily', 'Baseline LFT and lipid profile done.'],
    [3, 4, -14, 'Dengue suspected — recoverng', 'Fluids, Paracetamol, daily platelet monitoring', 'Platelets 92k, rising. No warning signs.'],
  ];
  recordDefs.forEach((row, i) => {
    const [pIdx, dIdx, offset, diagnosis, treatment, notes] = row;
    ins('medical_records', {
      record_code: `MR-${String(i + 1).padStart(4, '0')}`,
      patient_id: patients[pIdx], doctor_id: doctors[dIdx], visit_date: d(offset),
      diagnosis, treatment, notes,
      created_by: users[['priya@demo.local', 'sana@demo.local', 'rajesh@demo.local', 'arjun@demo.local'][dIdx]],
      updated_by: users['priya@demo.local'],
      created_at: `${d(offset)} 12:00:00`, updated_at: offset === -30 ? `${d(offset)} 16:00:00` : null,
    });
  });

  /* --- laboratory ------------------------------------------------------ */
  const labDefs = [
    [0, 'Complete Blood Count (CBC)', 'Hematology', 'completed', 'Hb 14.2 g/dL; WBC 7,400/µL; Platelets 2.6 lakh/µL', 'Hb 13–17 g/dL; WBC 4,000–11,000/µL'],
    [0, 'Lipid Profile', 'Biochemistry', 'completed', 'Total cholesterol 214 mg/dL; LDL 138; HDL 41; Triglycerides 168', 'LDL < 100 mg/dL'],
    [0, 'Serum Troponin-I', 'Cardiology', 'completed', '< 0.04 ng/mL (negative)', '< 0.04 ng/ng/mL'],
    [4, 'HbA1c', 'Biochemistry', 'completed', '6.8 %', '< 5.7 %'],
    [4, 'Serum Creatinine', 'Biochemistry', 'requested', '', '0.7–1.3 mg/dL'],
    [5, 'Allergy Panel (IgE)', 'Immunology', 'in_progress', '', 'Total IgE < 100 IU/mL'],
    [2, 'X-Ray Right Knee (AP/Lateral)', 'Radiology', 'requested', '', '—'],
    [6, 'MRI Lumbar Spine', 'Radiology', 'requested', '', '—'],
    [1, 'Sputum Culture', 'Microbiology', 'requested', '', 'No growth in 48 hours'],
    [3, 'Dengue NS1 Antigen', 'Serology', 'completed', 'Negative', 'Negative'],
  ];
  const seedReports = [
    'MEDICORE LABORATORY REPORT\nTest: Complete Blood Count\nPatient: Aarav Mehta\n--------------------------------\nHemoglobin      : 14.2 g/dL   (13.0 - 17.0)\nRBC Count        : 4.8 million/uL\nWBC Count        : 7,400 /uL   (4000 - 11000)\nPlatelet Count   : 260,000 /uL (150000 - 450000)\nHematocrit       : 42.1 %\n--------------------------------\nInterpretation: Within normal limits.\nVerified by: Dr. Kavita Rao, Pathologist\n',
    'MEDICORE LABORATORY REPORT\nTest: Lipid Profile\nPatient: Aarav Mehta\n--------------------------------\nTotal Cholesterol : 214 mg/dL  (< 200 ideal)\nLDL Cholesterol    : 138 mg/dL  (< 100 ideal)\nHDL Cholesterol    : 41 mg/dL   ( > 40 ideal)\nTriglycerides      : 168 mg/dL  (< 150 ideal)\n--------------------------------\nInterpretation: Mildly elevated LDL - dietary advice issued.\nVerified by: Dr. Kavita Rao, Pathologist\n',
    'MEDICORE LABORATORY REPORT\nTest: HbA1c\nPatient: Rohit Verma\n--------------------------------\nHbA1c             : 6.8 %      ( < 5.7 normal )\nEstimated Avg Glucose : 149 mg/dL\n--------------------------------\nInterpretation: Pre-diabetic range - correlate with fasting glucose.\nVerified by: Dr. Kavita Rao, Pathologist\n',
  ];
  let reportIdx = 0;
  labDefs.forEach((row, i) => {
    const [pIdx, test_name, category, status, result, reference_range] = row;
    const completed = status === 'completed';
    let file_name = '', original_name = '', file_type = '';
    if (completed && reportIdx < seedReports.length) {
      file_name = `seed-report-${i + 1}.txt`;
      original_name = `${test_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-report.txt`;
      file_type = 'text/plain';
      fs.writeFileSync(path.join(UPLOAD_DIR, file_name), seedReports[reportIdx], 'utf8');
      reportIdx++;
    }
    ins('lab_tests', {
      test_code: `LB-${String(i + 1).padStart(4, '0')}`,
      patient_id: patients[pIdx], test_name, category, status,
      requested_by: users['priya@demo.local'], requested_at: `${d(completed ? -6 : -2)} 10:00:00`,
      result, reference_range, notes: completed ? 'Sample collected fasting.' : '',
      file_name, original_name, file_type,
      uploaded_by: completed ? users['lab@demo.local'] : null,
      completed_at: completed ? `${d(-5)} 16:30:00` : null,
      updated_at: completed ? `${d(-5)} 16:30:00` : null,
    });
  });

  /* --- prescriptions ---------------------------------------------------- */
  const rxDefs = [
    [0, 0, -6, 'Stable angina, hypertension', [
      { name: 'Aspirin', strength: '75 mg', dosage: '1 tablet', frequency: 'Once daily (after breakfast)', duration: '30 days' },
      { name: 'Atorvastatin', strength: '20 mg', dosage: '1 tablet', frequency: 'Once daily (at bedtime)', duration: '30 days' },
      { name: 'Telmisartan', strength: '40 mg', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days' },
    ], 'Low-sodium diet. 30 min brisk walk daily. Report chest pain immediately.', 'After 4 weeks'],
    [2, 1, -5, 'Meniscus tear, right knee', [
      { name: 'Diclofenac', strength: '50 mg', dosage: '1 tablet', frequency: 'Twice daily (after food)', duration: '5 days' },
      { name: 'Pantoprazole', strength: '40 mg', dosage: '1 tablet', frequency: 'Once daily (before breakfast)', duration: '5 days' },
    ], 'Ice pack 15 min, 3x/day. Use knee brace while walking.', 'After 10 days'],
    [4, 0, -4, 'Essential hypertension', [
      { name: 'Telmisartan', strength: '40 mg', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days' },
    ], 'Reduce salt intake. Monitor BP at home every morning.', 'After 4 weeks'],
    [5, 3, -3, 'Allergic contact dermatitis', [
      { name: 'Cetirizine', strength: '10 mg', dosage: '1 tablet', frequency: 'Once daily (at night)', duration: '7 days' },
      { name: 'Hydrocortisone cream', strength: '1 %', dosage: 'Thin layer', frequency: 'Twice daily', duration: '7 days' },
    ], 'Avoid the suspected soap. Use a gentle moisturiser.', 'After 10 days'],
  ];
  rxDefs.forEach((row, i) => {
    const [pIdx, dIdx, offset, diagnosis, medicines, instructions, follow_up] = row;
    ins('prescriptions', {
      rx_code: `RX-${String(i + 1).padStart(4, '0')}`,
      patient_id: patients[pIdx], doctor_id: doctors[dIdx],
      appointment_id: apptIds[i] || null,
      diagnosis, medicines: JSON.stringify(medicines), instructions, follow_up,
      status: 'active', issued_date: d(offset), created_by: users['priya@demo.local'],
      created_at: `${d(offset)} 13:00:00`,
    });
  });

  /* --- billing ---------------------------------------------------------- */
  const invDefs = [
    [0, [[ 'Consultation - Cardiology', 1, 800], ['ECG (12-lead)', 1, 300]], 100, 'paid', -6],
    [1, [['Consultation - General Medicine', 1, 500]], 0, 'paid', -6],
    [2, [['Consultation - Orthopedics', 1, 700], ['X-Ray Right Knee', 1, 450]], 50, 'partial', -5],
    [4, [['Consultation - Cardiology', 1, 800], ['HbA1c', 1, 550], ['Serum Creatinine', 1, 350]], 0, 'pending', -4],
    [5, [['Consultation - Dermatology', 1, 650]], 0, 'paid', -3],
    [6, [['Consultation - Orthopedics', 1, 700], ['MRI Lumbar Spine', 1, 4500]], 200, 'pending', -1],
  ];
  invDefs.forEach((row, i) => {
    const [pIdx, items, discount, status, offset] = row;
    const itemsJs = items.map(([description, qty, amount]) => ({ description, qty, amount }));
    const subtotal = items.reduce((s, [, qty, amount]) => s + qty * amount, 0);
    const total = Math.max(0, subtotal - discount);
    const paid = status === 'paid' ? total : status === 'partial' ? Math.round(total / 2) : 0;
    const invId = ins('invoices', {
      invoice_no: `INV-${new Date().getFullYear()}-${String(i + 1).padStart(4, '0')}`,
      patient_id: patients[pIdx], items: JSON.stringify(itemsJs),
      subtotal, discount, total, paid_amount: paid, status,
      issue_date: d(offset), due_date: d(offset + 15),
      notes: '', created_by: users['reception@demo.local'],
      created_at: `${d(offset)} 14:00:00`,
    });
    if (paid > 0) {
      ins('payments', {
        payment_code: `PY-${String(i + 1).padStart(4, '0')}`,
        invoice_id: invId, amount: paid,
        method: i % 2 === 0 ? 'card' : 'cash',
        reference: i % 2 === 0 ? `TXN${884120 + i}` : '',
        paid_at: `${d(offset)} 15:00:00`, received_by: users['reception@demo.local'],
      });
    }
  });

  /* --- settings ---------------------------------------------------------- */
  const settings = {
    hospital_name: 'MediCore General Hospital',
    hospital_address: '214 Health Avenue, Pune, Maharashtra 411001',
    hospital_phone: '+91 20 4455 6677',
    hospital_email: 'care@medicore.example',
    currency: '₹',
    appointment_slot_minutes: '30',
    appointment_horizon_days: '30',
  };
  for (const [key, value] of Object.entries(settings)) ins('settings', { key, value });

  /* --- audit trail -------------------------------------------------------- */
  const audits = [
    ['admin@demo.local', 'Administrator', 'system.seed', 'system', '', 'Initial demo dataset created'],
    ['priya@demo.local', 'Doctor', 'record.create', 'medical_records', 'MR-0001', 'Consultation recorded for PT-0001'],
    ['lab@demo.local', 'Laboratory Staff', 'lab.upload', 'lab_tests', 'LB-0001', 'Report uploaded for CBC'],
    ['reception@demo.local', 'Receptionist', 'invoice.create', 'invoices', 'INV-0001', 'Invoice issued for PT-0001'],
    ['reception@demo.local', 'Receptionist', 'payment.record', 'payments', 'PY-0001', 'Payment received for INV-0001'],
    ['admin@demo.local', 'Administrator', 'user.create', 'users', '', 'Laboratory staff account created'],
    ['aarav@demo.local', 'Patient', 'auth.login', 'sessions', '', 'Patient portal login'],
  ];
  audits.forEach(([email, role, action, entity, entityId, detail], i) => {
    ins('audit_logs', {
      user_id: users[email] || null, user_name: '', user_role: role,
      action, entity, entity_id: entityId, detail,
      created_at: `${d(-(i + 1))} 11:00:00`,
    });
  });
  db.prepare('UPDATE audit_logs SET user_name = (SELECT name FROM users WHERE users.id = audit_logs.user_id) WHERE user_id IS NOT NULL').run();
}

/* ------------------------------- RESEED ------------------------------- */

/**
 * Wipe every table and rebuild the pristine demo dataset (`npm run reseed`).
 *
 * Safe to run while the dev server is up: the reset happens on its own
 * connection inside a single WAL transaction, so any other connection (e.g.
 * the running app) only ever observes the old dataset or the new one —
 * never a half-wiped state. `seedIfEmpty()` runs solely inside `open()`, so a
 * server that is already running will not try to seed concurrently.
 */
export function reseed() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = OFF'); // order-independent deletes; seed() inserts in FK order like open() does
    db.exec(SCHEMA); // idempotent — creates everything on a fresh database
    db.exec('BEGIN IMMEDIATE');
    try {
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
        .all();
      for (const { name } of tables) db.exec(`DELETE FROM "${name}"`);
      // restart AUTOINCREMENT so ids match a fresh seed (table exists only if
      // some AUTOINCREMENT table was ever created — SCHEMA guarantees it here)
      const seq = db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'`).get();
      if (seq) db.exec('DELETE FROM sqlite_sequence');
      seed(db);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch {}
      throw err;
    }
    db.exec('PRAGMA foreign_keys = ON');
    // success only: drop stale uploads from previous runs; seed() already
    // (re)wrote its own seed-report-*.txt files during the transaction
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      if (f.startsWith('seed-report-')) continue;
      try { fs.rmSync(path.join(UPLOAD_DIR, f), { force: true }); } catch {}
    }
    const counts = {};
    for (const t of ['users', 'patients', 'doctors', 'appointments', 'medical_records', 'lab_tests', 'prescriptions', 'invoices', 'payments', 'audit_logs']) {
      counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
    }
    return counts;
  } finally {
    db.close();
  }
}

export { safeJson };
