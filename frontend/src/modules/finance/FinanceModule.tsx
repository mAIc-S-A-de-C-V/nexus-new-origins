import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  TrendingUp, TrendingDown, CreditCard, Upload, Plus, Pencil, Trash2,
  X, Check, ChevronDown, DollarSign, FileText, ReceiptText,
} from 'lucide-react';

const API = import.meta.env.VITE_FINANCE_SERVICE_URL || 'http://localhost:9001';
const TENANT = 'tenant-001';
const H = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT };

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = 'salaries' | 'software' | 'admin' | 'finanzas' | 'oficina' | 'marketing';

const CATEGORY_LABELS: Record<Category, string> = {
  salaries:  'Salaries',
  software:  'Software',
  admin:     'Admin',
  finanzas:  'Finanzas',
  oficina:   'Oficina',
  marketing: 'Marketing',
};

const CATEGORY_COLORS: Record<Category, string> = {
  salaries:  '#7C3AED',
  software:  '#2563EB',
  admin:     '#D97706',
  finanzas:  '#DC2626',
  oficina:   '#059669',
  marketing: '#DB2777',
};

interface Transaction {
  id: string;
  category: Category;
  date: string;
  description: string;
  vendor?: string;
  payment_method?: string;
  amount_usd: number;
  notes?: string;
}

interface Revenue {
  id: string;
  date: string;
  description: string;
  client?: string;
  invoice_number?: string;
  amount_usd: number;
  currency: string;
  status: 'received' | 'pending';
  notes?: string;
}

interface Receivable {
  id: string;
  client: string;
  invoice_number?: string;
  invoice_date: string;
  due_date?: string;
  amount_usd: number;
  currency: string;
  status: 'pending' | 'partial' | 'paid' | 'overdue';
  paid_amount: number;
  balance: number;
  description?: string;
  notes?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  received: { bg: '#DCFCE7', color: '#15803D' },
  pending:  { bg: '#FEF9C3', color: '#A16207' },
  paid:     { bg: '#DCFCE7', color: '#15803D' },
  partial:  { bg: '#FEF9C3', color: '#A16207' },
  overdue:  { bg: '#FEE2E2', color: '#DC2626' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || { bg: '#F1F5F9', color: '#64748B' };
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500,
      backgroundColor: s.bg, color: s.color,
    }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{
      background: '#FFF', border: '1px solid #E2E8F0', borderRadius: '8px',
      padding: '16px 20px', minWidth: 160, flex: '1 1 160px',
    }}>
      <div style={{ fontSize: '11px', color: '#64748B', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 600, color }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Modal scaffold ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#FFF', borderRadius: '10px', width: 480, maxHeight: '90vh',
        overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.2)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #E2E8F0',
        }}>
          <span style={{ fontWeight: 600, fontSize: '14px' }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={16} color="#64748B" />
          </button>
        </div>
        <div style={{ padding: '20px' }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: '12px', color: '#64748B', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 32, padding: '0 10px', borderRadius: 4, fontSize: '13px',
  border: '1px solid #E2E8F0', boxSizing: 'border-box', outline: 'none',
};

// ── EXPENSES TAB ──────────────────────────────────────────────────────────────

function ExpensesTab() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<{ total: number; by_category: Record<string, number>; by_month: Record<string, number> } | null>(null);
  const [filterCat, setFilterCat] = useState<string>('');
  const [filterYear, setFilterYear] = useState<string>(new Date().getFullYear().toString());
  const [modal, setModal] = useState<Transaction | null | 'new'>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterCat) params.set('category', filterCat);
    if (filterYear) params.set('year', filterYear);
    const [txns, summ] = await Promise.all([
      fetch(`${API}/finance/transactions?${params}`, { headers: H }).then(r => r.json()),
      fetch(`${API}/finance/transactions/summary?year=${filterYear}`, { headers: H }).then(r => r.json()),
    ]);
    setRows(Array.isArray(txns) ? txns : []);
    setSummary(summ);
  }, [filterCat, filterYear]);

  useEffect(() => { load(); }, [load]);

  const save = async (data: Partial<Transaction>) => {
    const isNew = modal === 'new';
    const url = isNew ? `${API}/finance/transactions` : `${API}/finance/transactions/${(modal as Transaction).id}`;
    await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: H, body: JSON.stringify(data) });
    setModal(null);
    load();
  };

  const del = async (id: string) => {
    if (!confirm('Delete this transaction?')) return;
    await fetch(`${API}/finance/transactions/${id}`, { method: 'DELETE', headers: H });
    load();
  };

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API}/finance/transactions/upload`, {
      method: 'POST',
      headers: { 'x-tenant-id': TENANT },
      body: fd,
    }).then(r => r.json());
    setUploading(false);
    e.target.value = '';
    alert(`Imported ${res.imported} transactions (${res.skipped} skipped).`);
    load();
  };

  const initForm = (): Partial<Transaction> =>
    modal === 'new' ? { category: 'salaries', date: new Date().toISOString().slice(0, 10), amount_usd: 0 } : { ...(modal as Transaction) };

  return (
    <div>
      {/* Summary cards */}
      {summary && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <SummaryCard label="Total Expenses" value={fmt(summary.total)} color="#DC2626" />
          {Object.entries(summary.by_category).map(([cat, amt]) => (
            <SummaryCard
              key={cat}
              label={CATEGORY_LABELS[cat as Category] || cat}
              value={fmt(amt)}
              sub={summary.total ? `${((amt / summary.total) * 100).toFixed(1)}%` : ''}
              color={CATEGORY_COLORS[cat as Category] || '#64748B'}
            />
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)} style={{ ...inputStyle, width: 90 }}>
          {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
        </select>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ ...inputStyle, width: 140 }}>
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={uploadFile} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              height: 32, padding: '0 14px', borderRadius: 4, fontSize: '12px', cursor: 'pointer',
              border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#374151', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Upload size={13} />{uploading ? 'Importing…' : 'Upload Excel'}
          </button>
          <button
            onClick={() => setModal('new')}
            style={{
              height: 32, padding: '0 14px', borderRadius: 4, fontSize: '12px', cursor: 'pointer',
              border: 'none', background: '#7C3AED', color: '#FFF', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Plus size={13} /> Add Transaction
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Date', 'Category', 'Description', 'Vendor', 'Amount', ''].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 500, fontSize: '11px', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#94A3B8' }}>No transactions yet — add one or upload an Excel file.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <td style={{ padding: '9px 12px', color: '#64748B' }}>{r.date}</td>
                <td style={{ padding: '9px 12px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: '11px', fontWeight: 500,
                    background: (CATEGORY_COLORS[r.category] || '#64748B') + '18',
                    color: CATEGORY_COLORS[r.category] || '#64748B',
                  }}>
                    {CATEGORY_LABELS[r.category] || r.category}
                  </span>
                </td>
                <td style={{ padding: '9px 12px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                <td style={{ padding: '9px 12px', color: '#64748B' }}>{r.vendor || '—'}</td>
                <td style={{ padding: '9px 12px', fontWeight: 500, color: '#DC2626' }}>{fmt(r.amount_usd)}</td>
                <td style={{ padding: '9px 12px' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setModal(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4 }}><Pencil size={13} color="#94A3B8" /></button>
                    <button onClick={() => del(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4 }}><Trash2 size={13} color="#94A3B8" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modal && (
        <TransactionModal
          initial={initForm()}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function TransactionModal({ initial, onClose, onSave }: {
  initial: Partial<Transaction>;
  onClose: () => void;
  onSave: (d: Partial<Transaction>) => void;
}) {
  const [form, setForm] = useState(initial);
  const s = (k: string) => (v: string | number) => setForm(f => ({ ...f, [k]: v }));
  return (
    <Modal title={form.id ? 'Edit Transaction' : 'New Transaction'} onClose={onClose}>
      <Field label="Category">
        <select value={form.category || 'salaries'} onChange={e => s('category')(e.target.value)} style={inputStyle}>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Date">
        <input type="date" value={form.date || ''} onChange={e => s('date')(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Description">
        <input value={form.description || ''} onChange={e => s('description')(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Vendor / Payee">
        <input value={form.vendor || ''} onChange={e => s('vendor')(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Payment Method">
        <input value={form.payment_method || ''} onChange={e => s('payment_method')(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Amount (USD)">
        <input type="number" step="0.01" min="0" value={form.amount_usd ?? ''} onChange={e => s('amount_usd')(parseFloat(e.target.value))} style={inputStyle} />
      </Field>
      <Field label="Notes">
        <input value={form.notes || ''} onChange={e => s('notes')(e.target.value)} style={inputStyle} />
      </Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button onClick={onClose} style={{ height: 32, padding: '0 16px', borderRadius: 4, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
        <button onClick={() => onSave(form)} style={{ height: 32, padding: '0 16px', borderRadius: 4, border: 'none', background: '#7C3AED', color: '#FFF', fontSize: '13px', cursor: 'pointer' }}>Save</button>
      </div>
    </Modal>
  );
}

// ── REVENUE TAB ───────────────────────────────────────────────────────────────

function RevenueTab() {
  const [rows, setRows] = useState<Revenue[]>([]);
  const [summary, setSummary] = useState<{ total: number; received: number; pending: number } | null>(null);
  const [filterYear, setFilterYear] = useState<string>(new Date().getFullYear().toString());
  const [modal, setModal] = useState<Revenue | null | 'new'>(null);

  const load = useCallback(async () => {
    const [rev, summ] = await Promise.all([
      fetch(`${API}/finance/revenue?year=${filterYear}`, { headers: H }).then(r => r.json()),
      fetch(`${API}/finance/revenue/summary?year=${filterYear}`, { headers: H }).then(r => r.json()),
    ]);
    setRows(Array.isArray(rev) ? rev : []);
    setSummary(summ);
  }, [filterYear]);

  useEffect(() => { load(); }, [load]);

  const save = async (data: Partial<Revenue>) => {
    const isNew = modal === 'new';
    const url = isNew ? `${API}/finance/revenue` : `${API}/finance/revenue/${(modal as Revenue).id}`;
    await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: H, body: JSON.stringify(data) });
    setModal(null);
    load();
  };

  const del = async (id: string) => {
    if (!confirm('Delete this revenue entry?')) return;
    await fetch(`${API}/finance/revenue/${id}`, { method: 'DELETE', headers: H });
    load();
  };

  return (
    <div>
      {summary && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <SummaryCard label="Total Revenue" value={fmt(summary.total)} color="#059669" />
          <SummaryCard label="Received" value={fmt(summary.received)} color="#059669" />
          <SummaryCard label="Pending" value={fmt(summary.pending)} color="#D97706" />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)} style={{ ...inputStyle, width: 90 }}>
          {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
        </select>
        <button
          onClick={() => setModal('new')}
          style={{
            marginLeft: 'auto', height: 32, padding: '0 14px', borderRadius: 4, fontSize: '12px', cursor: 'pointer',
            border: 'none', background: '#059669', color: '#FFF', display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Plus size={13} /> Add Revenue
        </button>
      </div>
      <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Date', 'Description', 'Client', 'Invoice #', 'Amount', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 500, fontSize: '11px', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#94A3B8' }}>No revenue entries yet.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <td style={{ padding: '9px 12px', color: '#64748B' }}>{r.date}</td>
                <td style={{ padding: '9px 12px' }}>{r.description}</td>
                <td style={{ padding: '9px 12px', color: '#64748B' }}>{r.client || '—'}</td>
                <td style={{ padding: '9px 12px', color: '#64748B' }}>{r.invoice_number || '—'}</td>
                <td style={{ padding: '9px 12px', fontWeight: 500, color: '#059669' }}>{fmt(r.amount_usd)}</td>
                <td style={{ padding: '9px 12px' }}><StatusBadge status={r.status} /></td>
                <td style={{ padding: '9px 12px' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setModal(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Pencil size={13} color="#94A3B8" /></button>
                    <button onClick={() => del(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Trash2 size={13} color="#94A3B8" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && (
        <RevenueModal
          initial={modal === 'new' ? { date: new Date().toISOString().slice(0, 10), amount_usd: 0, status: 'received', currency: 'USD' } : { ...(modal as Revenue) }}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function RevenueModal({ initial, onClose, onSave }: { initial: Partial<Revenue>; onClose: () => void; onSave: (d: Partial<Revenue>) => void }) {
  const [form, setForm] = useState(initial);
  const s = (k: string) => (v: string | number) => setForm(f => ({ ...f, [k]: v }));
  return (
    <Modal title={form.id ? 'Edit Revenue' : 'New Revenue Entry'} onClose={onClose}>
      <Field label="Date"><input type="date" value={form.date || ''} onChange={e => s('date')(e.target.value)} style={inputStyle} /></Field>
      <Field label="Description"><input value={form.description || ''} onChange={e => s('description')(e.target.value)} style={inputStyle} /></Field>
      <Field label="Client"><input value={form.client || ''} onChange={e => s('client')(e.target.value)} style={inputStyle} /></Field>
      <Field label="Invoice Number"><input value={form.invoice_number || ''} onChange={e => s('invoice_number')(e.target.value)} style={inputStyle} /></Field>
      <Field label="Amount (USD)"><input type="number" step="0.01" min="0" value={form.amount_usd ?? ''} onChange={e => s('amount_usd')(parseFloat(e.target.value))} style={inputStyle} /></Field>
      <Field label="Status">
        <select value={form.status || 'received'} onChange={e => s('status')(e.target.value)} style={inputStyle}>
          <option value="received">Received</option>
          <option value="pending">Pending</option>
        </select>
      </Field>
      <Field label="Notes"><input value={form.notes || ''} onChange={e => s('notes')(e.target.value)} style={inputStyle} /></Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button onClick={onClose} style={{ height: 32, padding: '0 16px', borderRadius: 4, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
        <button onClick={() => onSave(form)} style={{ height: 32, padding: '0 16px', borderRadius: 4, border: 'none', background: '#059669', color: '#FFF', fontSize: '13px', cursor: 'pointer' }}>Save</button>
      </div>
    </Modal>
  );
}

// ── RECEIVABLES TAB ───────────────────────────────────────────────────────────

function ReceivablesTab() {
  const [rows, setRows] = useState<Receivable[]>([]);
  const [summary, setSummary] = useState<{ total_invoiced: number; total_collected: number; total_balance: number } | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [modal, setModal] = useState<Receivable | null | 'new'>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);
    const [recs, summ] = await Promise.all([
      fetch(`${API}/finance/receivables?${params}`, { headers: H }).then(r => r.json()),
      fetch(`${API}/finance/receivables/summary`, { headers: H }).then(r => r.json()),
    ]);
    setRows(Array.isArray(recs) ? recs : []);
    setSummary(summ);
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  const save = async (data: Partial<Receivable>) => {
    const isNew = modal === 'new';
    const url = isNew ? `${API}/finance/receivables` : `${API}/finance/receivables/${(modal as Receivable).id}`;
    await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: H, body: JSON.stringify(data) });
    setModal(null);
    load();
  };

  const del = async (id: string) => {
    if (!confirm('Delete this receivable?')) return;
    await fetch(`${API}/finance/receivables/${id}`, { method: 'DELETE', headers: H });
    load();
  };

  return (
    <div>
      {summary && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <SummaryCard label="Total Invoiced" value={fmt(summary.total_invoiced)} color="#2563EB" />
          <SummaryCard label="Collected" value={fmt(summary.total_collected)} color="#059669" />
          <SummaryCard label="Outstanding Balance" value={fmt(summary.total_balance)} color="#DC2626" />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inputStyle, width: 140 }}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
        <button
          onClick={() => setModal('new')}
          style={{
            marginLeft: 'auto', height: 32, padding: '0 14px', borderRadius: 4, fontSize: '12px', cursor: 'pointer',
            border: 'none', background: '#2563EB', color: '#FFF', display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Plus size={13} /> New Invoice
        </button>
      </div>
      <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Client', 'Invoice #', 'Invoice Date', 'Due Date', 'Amount', 'Paid', 'Balance', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 500, fontSize: '11px', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: '#94A3B8' }}>No accounts receivable yet.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <td style={{ padding: '9px 12px', fontWeight: 500 }}>{r.client}</td>
                <td style={{ padding: '9px 12px', color: '#64748B' }}>{r.invoice_number || '—'}</td>
                <td style={{ padding: '9px 12px', color: '#64748B' }}>{r.invoice_date}</td>
                <td style={{ padding: '9px 12px', color: r.due_date && r.status !== 'paid' && new Date(r.due_date) < new Date() ? '#DC2626' : '#64748B' }}>
                  {r.due_date || '—'}
                </td>
                <td style={{ padding: '9px 12px', fontWeight: 500 }}>{fmt(r.amount_usd)}</td>
                <td style={{ padding: '9px 12px', color: '#059669' }}>{fmt(r.paid_amount)}</td>
                <td style={{ padding: '9px 12px', fontWeight: 500, color: r.balance > 0 ? '#DC2626' : '#059669' }}>{fmt(r.balance)}</td>
                <td style={{ padding: '9px 12px' }}><StatusBadge status={r.status} /></td>
                <td style={{ padding: '9px 12px' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setModal(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Pencil size={13} color="#94A3B8" /></button>
                    <button onClick={() => del(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Trash2 size={13} color="#94A3B8" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && (
        <ReceivableModal
          initial={modal === 'new' ? { invoice_date: new Date().toISOString().slice(0, 10), amount_usd: 0, paid_amount: 0, status: 'pending', currency: 'USD' } : { ...(modal as Receivable) }}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function ReceivableModal({ initial, onClose, onSave }: { initial: Partial<Receivable>; onClose: () => void; onSave: (d: Partial<Receivable>) => void }) {
  const [form, setForm] = useState(initial);
  const s = (k: string) => (v: string | number) => setForm(f => ({ ...f, [k]: v }));
  return (
    <Modal title={form.id ? 'Edit Invoice' : 'New Invoice (CxC)'} onClose={onClose}>
      <Field label="Client"><input value={form.client || ''} onChange={e => s('client')(e.target.value)} style={inputStyle} /></Field>
      <Field label="Invoice Number"><input value={form.invoice_number || ''} onChange={e => s('invoice_number')(e.target.value)} style={inputStyle} /></Field>
      <Field label="Description"><input value={form.description || ''} onChange={e => s('description')(e.target.value)} style={inputStyle} /></Field>
      <Field label="Invoice Date"><input type="date" value={form.invoice_date || ''} onChange={e => s('invoice_date')(e.target.value)} style={inputStyle} /></Field>
      <Field label="Due Date"><input type="date" value={form.due_date || ''} onChange={e => s('due_date')(e.target.value)} style={inputStyle} /></Field>
      <Field label="Amount (USD)"><input type="number" step="0.01" min="0" value={form.amount_usd ?? ''} onChange={e => s('amount_usd')(parseFloat(e.target.value))} style={inputStyle} /></Field>
      <Field label="Paid Amount"><input type="number" step="0.01" min="0" value={form.paid_amount ?? ''} onChange={e => s('paid_amount')(parseFloat(e.target.value))} style={inputStyle} /></Field>
      <Field label="Status">
        <select value={form.status || 'pending'} onChange={e => s('status')(e.target.value)} style={inputStyle}>
          <option value="pending">Pending</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
      </Field>
      <Field label="Notes"><input value={form.notes || ''} onChange={e => s('notes')(e.target.value)} style={inputStyle} /></Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button onClick={onClose} style={{ height: 32, padding: '0 16px', borderRadius: 4, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
        <button onClick={() => onSave(form)} style={{ height: 32, padding: '0 16px', borderRadius: 4, border: 'none', background: '#2563EB', color: '#FFF', fontSize: '13px', cursor: 'pointer' }}>Save</button>
      </div>
    </Modal>
  );
}

// ── MAIN MODULE ───────────────────────────────────────────────────────────────

type TabId = 'expenses' | 'revenue' | 'receivables';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'expenses',    label: 'Gastos',            icon: <TrendingDown size={14} /> },
  { id: 'revenue',     label: 'Ingresos',           icon: <TrendingUp size={14} /> },
  { id: 'receivables', label: 'Cuentas por Cobrar', icon: <ReceiptText size={14} /> },
];

export default function FinanceModule() {
  const [tab, setTab] = useState<TabId>('expenses');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F8FAFC' }}>
      {/* Header */}
      <div style={{
        height: 48, display: 'flex', alignItems: 'center', padding: '0 20px', gap: '12px',
        background: '#FFF', borderBottom: '1px solid #E2E8F0', flexShrink: 0,
      }}>
        <DollarSign size={16} color="#059669" />
        <h1 style={{ fontSize: '16px', fontWeight: 500, color: '#0D1117', margin: 0 }}>Finance</h1>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginLeft: 16 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                height: 32, padding: '0 14px', borderRadius: 6, fontSize: '12px', cursor: 'pointer',
                border: 'none', display: 'flex', alignItems: 'center', gap: 6,
                background: tab === t.id ? '#EDE9FE' : 'transparent',
                color: tab === t.id ? '#6D28D9' : '#64748B',
                fontWeight: tab === t.id ? 600 : 400,
              }}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'expenses'    && <ExpensesTab />}
        {tab === 'revenue'     && <RevenueTab />}
        {tab === 'receivables' && <ReceivablesTab />}
      </div>
    </div>
  );
}
