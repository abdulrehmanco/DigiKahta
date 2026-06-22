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
  UserSearch,
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
        <div className="breezy-card px-5 py-4">
          <div className="text-xs text-slate-400">Total outstanding (udhaar)</div>
          <div className="text-2xl font-bold text-peach-400">{formatMoney(totalOutstanding)}</div>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-full bg-mint-500 text-white px-5 py-3 font-semibold hover:bg-mint-600 shadow-sm active:scale-[0.98]"
        >
          <UserPlus size={18} /> New customer
        </button>
      </div>

      <div className="flex items-center gap-2 rounded-full bg-white/90 backdrop-blur border border-white px-4 py-3 max-w-md shadow-sm focus-within:ring-2 focus-within:ring-mint-200">
        <Search size={18} className="text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search customers by name or phone…"
          className="flex-1 bg-transparent outline-none text-slate-800 placeholder:text-slate-400"
        />
      </div>

      <div className="breezy-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 className="animate-spin mr-2" size={20} /> Loading customers…
          </div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelected(c)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-mint-50/60 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-mint-200 flex items-center justify-center font-semibold text-mint-600">
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
                      Number(c.current_balance) > 0 ? 'text-peach-400' : 'text-slate-400'
                    }`}
                  >
                    {formatMoney(c.current_balance)}
                  </div>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="py-14">
                <div className="flex flex-col items-center text-center">
                  <div className="h-14 w-14 rounded-2xl bg-peach-100 flex items-center justify-center mb-3">
                    <UserSearch className="text-peach-400" size={26} />
                  </div>
                  <p className="font-semibold text-slate-600">
                    {customers.length === 0 ? 'No customers yet' : 'Customer not found'}
                  </p>
                  <p className="text-sm text-slate-400 mt-1">
                    {customers.length === 0
                      ? 'Click “New customer” to create your first profile.'
                      : `Nobody matches “${query.trim()}”. Try another name or phone.`}
                  </p>
                </div>
              </li>
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
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-slate-500 hover:text-slate-700 text-sm"
      >
        <ArrowLeft size={16} /> Back to customers
      </button>

      <div className="breezy-card p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-mint-200 text-mint-600 flex items-center justify-center text-xl font-bold">
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
            className={`text-3xl font-bold ${balance > 0 ? 'text-peach-400' : 'text-mint-600'}`}
          >
            {formatMoney(balance)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Manual ledger entry — charge (udhaar) or payment */}
        <form
          onSubmit={(e) => e.preventDefault()}
          className="breezy-card p-5 space-y-3"
        >
          <div className="flex items-center gap-2 text-slate-800 font-bold">
            <HandCoins size={18} className="text-mint-600" /> Record a ledger entry
          </div>
          <input
            type="number"
            min={1}
            step="0.01"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            placeholder="Amount (Rs)"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-mint-200 outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => record('charge')}
              disabled={saving || !payAmount}
              className="flex items-center justify-center gap-1 rounded-full bg-peach-300 text-white px-3 py-2.5 font-semibold hover:bg-peach-400 disabled:opacity-50 active:scale-[0.98]"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <ArrowUpRight size={16} />}
              Add Udhaar
            </button>
            <button
              type="button"
              onClick={() => record('payment')}
              disabled={saving || !payAmount}
              className="flex items-center justify-center gap-1 rounded-full bg-mint-500 text-white px-3 py-2.5 font-semibold hover:bg-mint-600 disabled:opacity-50 active:scale-[0.98]"
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
        <div className="breezy-card p-5 space-y-3 flex flex-col">
          <div className="flex items-center gap-2 text-slate-800 font-bold">
            <MessageCircle size={18} className="text-green-600" /> Payment reminder
          </div>
          <p className="text-sm text-slate-500 flex-1">
            Send {customer.name} a pre-filled WhatsApp message detailing their outstanding balance.
          </p>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noreferrer"
            className={`flex items-center justify-center gap-2 rounded-full px-4 py-3 font-semibold text-white transition active:scale-[0.98] ${
              balance > 0 && customer.phone
                ? 'bg-green-500 hover:bg-green-600'
                : 'bg-slate-300 pointer-events-none'
            }`}
          >
            <MessageCircle size={18} /> Send WhatsApp reminder
          </a>
        </div>
      </div>

      {/* Audit trail */}
      <div className="breezy-card overflow-hidden">
        <div className="px-5 py-4 font-bold text-slate-800">Transaction history</div>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="animate-spin mr-2" size={20} /> Loading ledger…
          </div>
        ) : txns.length === 0 ? (
          <div className="py-12 text-center text-slate-400">No transactions yet.</div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {txns.map((t) => {
              const isCharge = t.type === 'charge';
              return (
                <li key={t.id} className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-9 w-9 rounded-full flex items-center justify-center ${
                        isCharge ? 'bg-peach-100 text-peach-400' : 'bg-mint-100 text-mint-600'
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
                    className={`font-semibold ${isCharge ? 'text-peach-400' : 'text-mint-600'}`}
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
    <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">New customer</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer name"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-mint-200 outline-none"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (e.g. 923001234567)"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-mint-200 outline-none"
          />
          {error && <p className="text-sm text-rose-500">{error}</p>}
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="w-full rounded-full bg-mint-500 text-white py-2.5 font-semibold hover:bg-mint-600 disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? 'Saving…' : 'Add customer'}
          </button>
        </form>
      </div>
    </div>
  );
}
