import { useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut
} from 'firebase/auth';
import { deleteProofBlob, getProofBlob, putProofBlob } from './db.js';
import { auth, isFirebaseConfigured, provider } from './firebase.js';

const STATE_KEY_PREFIX = 'payrollControlCenterReactV2';

const seededEmployees = [
  { id: crypto.randomUUID(), name: 'Avery Chen', department: 'Engineering', salary: 6800 },
  { id: crypto.randomUUID(), name: 'Jordan Brooks', department: 'Finance', salary: 5900 },
  { id: crypto.randomUUID(), name: 'Taylor Singh', department: 'Operations', salary: 6200 },
  { id: crypto.randomUUID(), name: 'Casey Miller', department: 'People Ops', salary: 5600 },
  { id: crypto.randomUUID(), name: 'Morgan Patel', department: 'Sales', salary: 6400 },
  { id: crypto.randomUUID(), name: 'Riley Gomez', department: 'Support', salary: 4300 }
];

function todayMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value || 0);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function monthLabel(month) {
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon) return month;
  const date = new Date(year, mon - 1, 1);
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function buildInitialState(storageKey) {
  const loaded = safeParse(localStorage.getItem(storageKey));
  return {
    selectedMonth: loaded?.selectedMonth || todayMonth(),
    employees:
      Array.isArray(loaded?.employees) && loaded.employees.length ? loaded.employees : seededEmployees,
    records: loaded?.records || {}
  };
}

function ensureMonthRecords(state, month) {
  const nextRecords = { ...state.records };
  const monthRecords = { ...(nextRecords[month] || {}) };

  for (const employee of state.employees) {
    if (!monthRecords[employee.id]) {
      monthRecords[employee.id] = {
        paid: false,
        paymentDate: '',
        proofs: []
      };
    }
  }

  nextRecords[month] = monthRecords;
  return { ...state, records: nextRecords };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(isFirebaseConfigured);
  const [authError, setAuthError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [adding, setAdding] = useState({ name: '', department: '', salary: '' });
  const [state, setState] = useState(() => {
    const initial = buildInitialState(`${STATE_KEY_PREFIX}:guest`);
    return ensureMonthRecords(initial, initial.selectedMonth);
  });

  const storageKey = `${STATE_KEY_PREFIX}:${user?.uid || 'guest'}`;

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;

    const unsubscribe = onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setAuthLoading(false);
      },
      (error) => {
        setAuthError(error.message || 'Authentication failed.');
        setAuthLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (authLoading) return;
    const initial = buildInitialState(storageKey);
    setState(ensureMonthRecords(initial, initial.selectedMonth));
  }, [authLoading, storageKey]);

  useEffect(() => {
    if (authLoading) return;
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, [authLoading, state, storageKey]);

  const monthRecords = state.records[state.selectedMonth] || {};

  const filteredEmployees = useMemo(() => {
    return state.employees.filter((employee) => {
      const record = monthRecords[employee.id];
      if (!record) return true;
      if (statusFilter === 'paid') return record.paid;
      if (statusFilter === 'pending') return !record.paid;
      return true;
    });
  }, [state.employees, monthRecords, statusFilter]);

  const summary = useMemo(() => {
    const totalEmployees = state.employees.length;
    const paidCount = state.employees.filter((employee) => monthRecords[employee.id]?.paid).length;
    const pendingCount = totalEmployees - paidCount;
    const totalPayroll = state.employees.reduce((sum, employee) => sum + Number(employee.salary), 0);
    const paidPayroll = state.employees
      .filter((employee) => monthRecords[employee.id]?.paid)
      .reduce((sum, employee) => sum + Number(employee.salary), 0);
    const missingProofs = state.employees.filter(
      (employee) => monthRecords[employee.id]?.paid && !(monthRecords[employee.id]?.proofs?.length)
    ).length;

    return {
      totalEmployees,
      paidCount,
      pendingCount,
      totalPayroll,
      paidPayroll,
      missingProofs
    };
  }, [state.employees, monthRecords]);

  const activity = useMemo(() => {
    const uploads = [];
    for (const employee of state.employees) {
      const proofs = monthRecords[employee.id]?.proofs || [];
      for (const proof of proofs) {
        uploads.push({
          employee: employee.name,
          fileName: proof.fileName,
          fileSize: proof.fileSize,
          uploadedAt: proof.uploadedAt
        });
      }
    }

    return uploads.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)).slice(0, 20);
  }, [state.employees, monthRecords]);

  function updateRecord(employeeId, updateFn) {
    setState((prev) => {
      const ensured = ensureMonthRecords(prev, prev.selectedMonth);
      const monthMap = ensured.records[ensured.selectedMonth];
      const updated = updateFn(monthMap[employeeId]);

      return {
        ...ensured,
        records: {
          ...ensured.records,
          [ensured.selectedMonth]: {
            ...monthMap,
            [employeeId]: updated
          }
        }
      };
    });
  }

  function handleAddEmployee(event) {
    event.preventDefault();
    const name = adding.name.trim();
    const department = adding.department.trim();
    const salary = Number(adding.salary);

    if (!name || !department || !Number.isFinite(salary) || salary < 0) {
      window.alert('Please provide valid employee details.');
      return;
    }

    setState((prev) => {
      const next = {
        ...prev,
        employees: [...prev.employees, { id: crypto.randomUUID(), name, department, salary }]
      };
      return ensureMonthRecords(next, next.selectedMonth);
    });

    setAdding({ name: '', department: '', salary: '' });
  }

  function handleMonthChange(value) {
    const nextMonth = value || todayMonth();
    setState((prev) => ensureMonthRecords({ ...prev, selectedMonth: nextMonth }, nextMonth));
  }

  function markAllPaid() {
    const today = new Date().toISOString().slice(0, 10);
    setState((prev) => {
      const ensured = ensureMonthRecords(prev, prev.selectedMonth);
      const monthMap = ensured.records[ensured.selectedMonth];
      const nextMonthMap = {};

      for (const employee of ensured.employees) {
        const current = monthMap[employee.id];
        nextMonthMap[employee.id] = {
          ...current,
          paid: true,
          paymentDate: current.paymentDate || today
        };
      }

      return {
        ...ensured,
        records: {
          ...ensured.records,
          [ensured.selectedMonth]: nextMonthMap
        }
      };
    });
  }

  function exportCsv() {
    const rows = [
      ['Employee', 'Department', 'Salary', 'Status', 'Payment Date', 'Proof Count'],
      ...state.employees.map((employee) => {
        const record = monthRecords[employee.id] || { paid: false, paymentDate: '', proofs: [] };
        return [
          employee.name,
          employee.department,
          employee.salary,
          record.paid ? 'Paid' : 'Pending',
          record.paymentDate,
          (record.proofs || []).length
        ];
      })
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payroll-${state.selectedMonth}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function uploadProof(employeeId, file) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      window.alert('Only PDF files are allowed as proof of payment.');
      return;
    }

    const proofId = crypto.randomUUID();
    await putProofBlob(proofId, file);

    updateRecord(employeeId, (current) => ({
      ...current,
      proofs: [
        ...(current.proofs || []),
        {
          id: proofId,
          fileName: file.name,
          fileSize: file.size,
          uploadedAt: new Date().toISOString()
        }
      ]
    }));
  }

  async function viewProof(proofId) {
    const blob = await getProofBlob(proofId);
    if (!blob) {
      window.alert('Proof file not found in local storage.');
      return;
    }

    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 12000);
  }

  async function removeProof(employeeId, proofId) {
    updateRecord(employeeId, (current) => ({
      ...current,
      proofs: (current.proofs || []).filter((proof) => proof.id !== proofId)
    }));
    await deleteProofBlob(proofId);
  }

  async function handleGoogleSignIn() {
    setAuthError('');
    if (!isFirebaseConfigured) return;

    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/cancelled-popup-request') {
        await signInWithRedirect(auth, provider);
        return;
      }
      setAuthError(error.message || 'Google sign-in failed.');
    }
  }

  async function handleSignOut() {
    setAuthError('');
    if (!isFirebaseConfigured) return;
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      setAuthError(error.message || 'Sign-out failed.');
    }
  }

  if (!isFirebaseConfigured) {
    return (
      <div className="app-shell">
        <main className="layout">
          <section className="panel hero">
            <p className="kicker">Setup Required</p>
            <h1>Configure Firebase Google Login</h1>
            <p>
              Add Firebase environment values to `.env.local` so authentication can be enabled. See
              `README.md` for exact setup and GitHub Pages deployment steps.
            </p>
          </section>
        </main>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="app-shell">
        <main className="layout">
          <section className="panel hero">
            <h1>Loading authentication...</h1>
          </section>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-shell">
        <main className="layout">
          <section className="panel hero">
            <p className="kicker">Secure Access</p>
            <h1>Payroll Control Center</h1>
            <p>Sign in with Google to access payroll operations.</p>
            <button className="btn btn-primary" onClick={handleGoogleSignIn}>
              Continue with Google
            </button>
            {authError ? <p className="muted error-text">{authError}</p> : null}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <div className="ambient ambient-c" />

      <main className="layout">
        <header className="hero panel">
          <div className="topbar">
            <div>
              <p className="kicker">Payroll Intelligence</p>
              <h1>Payroll Control Center</h1>
              <p>
                Operate monthly payroll, attach proof-of-payment PDFs, and keep an audit trail for your full team in
                one place.
              </p>
            </div>
            <div className="user-box">
              <div className="hero-chip">{user.email}</div>
              <button className="btn btn-soft" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          </div>
          <div className="hero-chip">Month: {monthLabel(state.selectedMonth)}</div>
          {authError ? <p className="muted error-text">{authError}</p> : null}
        </header>

        <section className="metrics-grid">
          <article className="metric panel">
            <p>Team Size</p>
            <h3>{summary.totalEmployees}</h3>
          </article>
          <article className="metric panel">
            <p>Paid This Month</p>
            <h3>
              {summary.paidCount} / {summary.totalEmployees}
            </h3>
          </article>
          <article className="metric panel">
            <p>Total Payroll</p>
            <h3>{formatCurrency(summary.totalPayroll)}</h3>
          </article>
          <article className="metric panel">
            <p>Paid So Far</p>
            <h3>{formatCurrency(summary.paidPayroll)}</h3>
          </article>
          <article className="metric panel">
            <p>Pending</p>
            <h3>{summary.pendingCount}</h3>
          </article>
          <article className="metric panel warning">
            <p>Paid Without PDF</p>
            <h3>{summary.missingProofs}</h3>
          </article>
        </section>

        <section className="control-grid">
          <form className="panel form-panel" onSubmit={handleAddEmployee}>
            <h2>Add Employee</h2>
            <label>
              Name
              <input
                value={adding.name}
                onChange={(event) => setAdding((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Jamie Rivera"
                required
              />
            </label>
            <label>
              Department
              <input
                value={adding.department}
                onChange={(event) => setAdding((prev) => ({ ...prev, department: event.target.value }))}
                placeholder="Operations"
                required
              />
            </label>
            <label>
              Monthly Salary ($)
              <input
                type="number"
                min="0"
                step="0.01"
                value={adding.salary}
                onChange={(event) => setAdding((prev) => ({ ...prev, salary: event.target.value }))}
                placeholder="6200"
                required
              />
            </label>
            <button className="btn btn-primary" type="submit">
              Add Employee
            </button>
          </form>

          <div className="panel quick-panel">
            <h2>Monthly Controls</h2>
            <div className="quick-row">
              <label>
                Payroll Month
                <input
                  type="month"
                  value={state.selectedMonth}
                  onChange={(event) => handleMonthChange(event.target.value)}
                />
              </label>
              <label>
                Status Filter
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">All</option>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                </select>
              </label>
            </div>
            <div className="quick-row actions">
              <button type="button" className="btn btn-soft" onClick={markAllPaid}>
                Mark All Paid
              </button>
              <button type="button" className="btn btn-primary" onClick={exportCsv}>
                Export CSV
              </button>
            </div>
          </div>
        </section>

        <section className="main-grid">
          <article className="panel table-panel">
            <div className="table-heading">
              <h2>Employee Payroll Tracker</h2>
              <p>Proof files are stored locally in your browser and linked to each month and employee.</p>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Salary</th>
                    <th>Status</th>
                    <th>Payment Date</th>
                    <th>Upload PDF</th>
                    <th>Proof Files</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((employee) => {
                    const record = monthRecords[employee.id] || { paid: false, paymentDate: '', proofs: [] };
                    return (
                      <tr key={employee.id}>
                        <td>
                          <strong>{employee.name}</strong>
                        </td>
                        <td>{employee.department}</td>
                        <td>{formatCurrency(employee.salary)}</td>
                        <td>
                          <div className={`pill ${record.paid ? 'paid' : 'pending'}`}>
                            {record.paid ? 'Paid' : 'Pending'}
                          </div>
                          <label className="toggle-row">
                            <input
                              type="checkbox"
                              checked={record.paid}
                              onChange={(event) => {
                                updateRecord(employee.id, (current) => ({
                                  ...current,
                                  paid: event.target.checked,
                                  paymentDate:
                                    event.target.checked && !current.paymentDate
                                      ? new Date().toISOString().slice(0, 10)
                                      : current.paymentDate
                                }));
                              }}
                            />
                            Set paid
                          </label>
                        </td>
                        <td>
                          <input
                            type="date"
                            value={record.paymentDate || ''}
                            onChange={(event) => {
                              updateRecord(employee.id, (current) => ({
                                ...current,
                                paymentDate: event.target.value
                              }));
                            }}
                          />
                        </td>
                        <td>
                          <label className="upload-btn">
                            <input
                              type="file"
                              accept="application/pdf"
                              onChange={async (event) => {
                                const file = event.target.files?.[0];
                                event.target.value = '';
                                await uploadProof(employee.id, file);
                              }}
                            />
                            Add PDF
                          </label>
                        </td>
                        <td>
                          <div className="proofs">
                            {(record.proofs || []).length === 0 && <span className="muted">No PDF uploaded</span>}
                            {(record.proofs || []).map((proof) => (
                              <div className="proof-item" key={proof.id}>
                                <span>
                                  {proof.fileName} ({formatBytes(proof.fileSize)})
                                </span>
                                <button type="button" className="btn-chip" onClick={() => viewProof(proof.id)}>
                                  View
                                </button>
                                <button
                                  type="button"
                                  className="btn-chip danger"
                                  onClick={() => removeProof(employee.id, proof.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>

          <aside className="panel activity-panel">
            <h2>Recent Uploads</h2>
            <div className="activity-list">
              {activity.length === 0 && <p className="muted">No proof uploads for this month yet.</p>}
              {activity.map((item) => (
                <article className="activity-card" key={`${item.employee}-${item.fileName}-${item.uploadedAt}`}>
                  <h4>{item.employee}</h4>
                  <p>{item.fileName}</p>
                  <small>
                    {new Date(item.uploadedAt).toLocaleString()} | {formatBytes(item.fileSize)}
                  </small>
                </article>
              ))}
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
