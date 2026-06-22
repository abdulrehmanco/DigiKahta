import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Search,
  Phone,
  ArrowLeft,
  MessageCircle,
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  HandCoins,
  UserPlus,
  X,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import type { Customer, KhataTransaction } from '../types';
import { formatMoney } from '../lib/format';

export default function KhataScreen() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('customers').select('*').order('current_balance', {
      ascending: false,
    });
    setCustomers((data as Customer[]) ?? []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone?.includes(q),
    );
  }, [query, customers]);

  const totalOutstanding = customers.reduce((s, c) => s + Number(c.current_balance), 0);

  if (selected) {
    return (
      <CustomerDetail
        customer={selected}
        onBack={() => {
          setSelected(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-xs text-amber-700">Total outstanding (udhaar)</div>
          <div className="text-2xl font-bold text-amber-800">{formatMoney(totalOutstanding)}</div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 text-white px-4 py-2.5 font-medium hover:bg-emerald-700"
        >
          <UserPlus size={18} /> New customer
        </button>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 max-w-md focus-within:border-emerald-500">
        <Search size={18} className="text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search customers by name or phone…"
          className="flex-1 outline-none text-slate-800"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 className="animate-spin mr-2" size={20} /> Loading customers…
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setSelected(c)}
                  className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center font-semibold text-slate-500">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-slate-800">{c.name}</div>
                      <div className="text-xs text-slate-400 flex items-center gap-1">
                        <Phone size={11} /> {c.phone ?? '—'}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`font-semibold ${
                      Number(c.current_balance) > 0 ? 'text-amber-600' : 'text-slate-400'
                    }`}
                  >
                    {formatMoney(c.current_balance)}
                  </div>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-4 py-12 text-center text-slate-400">No customers found.</li>
            )}
          </ul>
        )}
      </div>

      {showAdd && (
        <AddCustomerModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer detail — audit trail + repayment + WhatsApp reminder
// ---------------------------------------------------------------------------
function CustomerDetail({ customer, onBack }: { customer: Customer; onBack: () => void }) {
  const [txns, setTxns] = useState<KhataTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(Number(customer.current_balance));
  const [payAmount, setPayAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadTxns();
  }, [customer.id]);

  async function loadTxns() {
    setLoading(true);
    const [{ data: t }, { data: c }] = await Promise.all([
      supabase
        .from('khata_transactions')
        .select('*')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false }),
      supabase.from('customers').select('current_balance').eq('id', customer.id).single(),
    ]);
    setTxns((t as KhataTransaction[]) ?? []);
    if (c) setBalance(Number((c as { current_balance: number }).current_balance));
    setLoading(false);
  }

  async function record(type: 'charge' | 'payment') {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;
    setSaving(true);
    const rpc = type === 'charge' ? 'record_khata_charge' : 'record_khata_payment';
    const { error } = await supabase.rpc(rpc, {
      p_customer_id: customer.id,
      p_amount: amount,
    });
    setSaving(false);
    if (!error) {
      setPayAmount('');
      await loadTxns();
    }
  }

  // Pre-filled WhatsApp reminder.
  const whatsappHref = useMemo(() => {
    const phone = (customer.phone ?? '').replace(/[^\d]/g, '');
    const message =
      `Assalam-o-Alaikum ${customer.name}, this is a friendly reminder from our shop. ` +
      `Your outstanding balance (khata) is ${formatMoney(balance)}. ` +
      `Kindly clear it at your convenience. Shukriya!`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }, [customer, balance]);

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-slate-500 hover:text-slate-700 text-sm"
      >
        <ArrowLeft size={16} /> Back to customers
      </button>

      <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-bold">
            {customer.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">{customer.name}</h2>
            <p className="text-sm text-slate-400 flex items-center gap-1">
              <Phone size={13} /> {customer.phone ?? '—'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">Current balance</div>
          <div
            className={`text-3xl font-bold ${balance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}
          >
            {formatMoney(balance)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Manual ledger entry — charge (udhaar) or payment */}
        <form
          onSubmit={(e) => e.preventDefault()}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
        >
          <div className="flex items-center gap-2 text-slate-700 font-semibold">
            <HandCoins size={18} className="text-emerald-600" /> Record a ledger entry
          </div>
          <input
            type="number"
            min={1}
            step="0.01"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            placeholder="Amount (Rs)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => record('charge')}
              disabled={saving || !payAmount}
              className="flex items-center justify-center gap-1 rounded-lg bg-amber-500 text-white px-3 py-2 font-medium hover:bg-amber-600 disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <ArrowUpRight size={16} />}
              Add Udhaar
            </button>
            <button
              type="button"
              onClick={() => record('payment')}
              disabled={saving || !payAmount}
              className="flex items-center justify-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <ArrowDownLeft size={16} />}
              Payment
            </button>
          </div>
          <p className="text-xs text-slate-400">
            “Add Udhaar” increases the balance (credit given); “Payment” reduces it (cash received).
          </p>
        </form>

        {/* WhatsApp reminder */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 flex flex-col">
          <div className="flex items-center gap-2 text-slate-700 font-semibold">
            <MessageCircle size={18} className="text-green-600" /> Payment reminder
          </div>
          <p className="text-sm text-slate-500 flex-1">
            Send {customer.name} a pre-filled WhatsApp message detailing their outstanding balance.
          </p>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noreferrer"
            className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-medium text-white transition ${
              balance > 0 && customer.phone
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-slate-300 pointer-events-none'
            }`}
          >
            <MessageCircle size={18} /> Send WhatsApp reminder
          </a>
        </div>
      </div>

      {/* Audit trail */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-700">
          Transaction history
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="animate-spin mr-2" size={20} /> Loading ledger…
          </div>
        ) : txns.length === 0 ? (
          <div className="py-12 text-center text-slate-400">No transactions yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {txns.map((t) => {
              const isCharge = t.type === 'charge';
              return (
                <li key={t.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-9 w-9 rounded-full flex items-center justify-center ${
                        isCharge ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'
                      }`}
                    >
                      {isCharge ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}
                    </div>
                    <div>
                      <div className="font-medium text-slate-700 capitalize">
                        {isCharge ? 'Credit sale (charge)' : 'Payment received'}
                      </div>
                      <div className="text-xs text-slate-400">
                        {new Date(t.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`font-semibold ${isCharge ? 'text-amber-600' : 'text-emerald-600'}`}
                  >
                    {isCharge ? '+' : '−'}
                    {formatMoney(Number(t.amount))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add customer modal
// ---------------------------------------------------------------------------
function AddCustomerModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const { error } = await supabase
      .from('customers')
      .insert({ name: name.trim(), phone: phone.trim() || null });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">New customer</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer name"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 outline-none"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (e.g. 923001234567)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 outline-none"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="w-full rounded-lg bg-emerald-600 text-white py-2.5 font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add customer'}
          </button>
        </form>
      </div>
    </div>
  );
}
