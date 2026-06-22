import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ScanLine,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  CheckCircle2,
  Loader2,
  UserSearch,
  X,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import type { CartLine, Customer, PaymentMethod, Product } from '../types';
import { formatMoney, formatPercent } from '../lib/format';

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'khata'];

export default function POSScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // --- data loading ---------------------------------------------------------
  useEffect(() => {
    void loadProducts();
    void loadCustomers();
    searchRef.current?.focus();
  }, []);

  async function loadProducts() {
    const { data } = await supabase
      .from('products')
      .select('*')
      .order('name', { ascending: true });
    setProducts((data as Product[]) ?? []);
  }

  async function loadCustomers() {
    const { data } = await supabase
      .from('customers')
      .select('*')
      .order('name', { ascending: true });
    setCustomers((data as Customer[]) ?? []);
  }

  // --- product search -------------------------------------------------------
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          p.barcode?.toLowerCase() === q ||
          p.name.toLowerCase().includes(q) ||
          p.barcode?.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [query, products]);

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    setQuery('');
    searchRef.current?.focus();
  }

  // Pressing Enter: if the query is an exact barcode, add it instantly (scanner-style).
  function handleScan(e: FormEvent) {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q) return;
    const exact = products.find((p) => p.barcode?.toLowerCase() === q);
    if (exact) {
      addToCart(exact);
    } else if (matches.length === 1) {
      addToCart(matches[0]);
    }
  }

  function setQty(productId: string, qty: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.product.id === productId ? { ...l, quantity: qty } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.product.id !== productId));
  }

  // --- live calculations ----------------------------------------------------
  const totals = useMemo(() => {
    let amount = 0;
    let cost = 0;
    for (const line of cart) {
      amount += line.product.selling_price * line.quantity;
      cost += line.product.cost_price * line.quantity;
    }
    const profit = amount - cost;
    const margin = amount > 0 ? profit / amount : 0;
    return { amount, cost, profit, margin };
  }, [cart]);

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.phone?.includes(q))
      .slice(0, 8);
  }, [customerQuery, customers]);

  // --- checkout -------------------------------------------------------------
  async function checkout() {
    setError(null);
    if (cart.length === 0) return;
    if (payment === 'khata' && !customer) {
      setError('Select a customer for khata (credit) sales.');
      return;
    }

    setSubmitting(true);
    const { error: rpcError } = await supabase.rpc('process_sale', {
      p_payment_method: payment,
      p_total_amount: Number(totals.amount.toFixed(2)),
      p_total_profit: Number(totals.profit.toFixed(2)),
      p_items: cart.map((l) => ({
        product_id: l.product.id,
        quantity: l.quantity,
        unit_price: l.product.selling_price,
        unit_cost: l.product.cost_price,
      })),
      p_customer_id: payment === 'khata' ? customer!.id : null,
    });
    setSubmitting(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setToast(`Sale complete — ${formatMoney(totals.amount)}`);
    setCart([]);
    setPayment('cash');
    setCustomer(null);
    setCustomerQuery('');
    await loadProducts(); // refresh stock counts
    await loadCustomers(); // refresh balances
    setTimeout(() => setToast(null), 3500);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
      {/* ---- Left: search + cart ---- */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        <form onSubmit={handleScan} className="relative">
          <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 shadow-sm focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-200">
            <ScanLine className="text-emerald-600" size={22} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Scan barcode or search product name…"
              className="flex-1 outline-none text-slate-800"
            />
          </div>
          {matches.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => addToCart(p)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-emerald-50 text-left"
                  >
                    <span>
                      <span className="font-medium text-slate-800">{p.name}</span>
                      <span className="text-xs text-slate-400 ml-2">{p.barcode}</span>
                    </span>
                    <span className="text-sm text-slate-600">
                      {formatMoney(p.selling_price)} · {p.stock_quantity} in stock
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>

        <div className="flex-1 rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 text-slate-700 font-semibold">
            <ShoppingCart size={18} /> Cart ({cart.length})
          </div>

          {cart.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm py-16">
              Scan or search to add items.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-y-auto">
              {cart.map((line) => (
                <li key={line.product.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 truncate">{line.product.name}</p>
                    <p className="text-xs text-slate-400">
                      {formatMoney(line.product.selling_price)} each
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setQty(line.product.id, line.quantity - 1)}
                      className="h-7 w-7 rounded-md bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) =>
                        setQty(line.product.id, Math.max(1, Number(e.target.value) || 1))
                      }
                      className="w-12 text-center rounded-md border border-slate-200 py-1"
                    />
                    <button
                      onClick={() => setQty(line.product.id, line.quantity + 1)}
                      className="h-7 w-7 rounded-md bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  <div className="w-24 text-right font-semibold text-slate-800">
                    {formatMoney(line.product.selling_price * line.quantity)}
                  </div>

                  <button
                    onClick={() => removeLine(line.product.id)}
                    className="text-slate-300 hover:text-red-500"
                  >
                    <Trash2 size={18} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---- Right: payment + summary ---- */}
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h3 className="font-semibold text-slate-700">Payment</h3>

          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m}
                onClick={() => setPayment(m)}
                className={`rounded-lg py-2 text-sm font-medium capitalize border transition ${
                  payment === m
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {payment === 'khata' && (
            <div className="relative">
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Customer (required)
              </label>
              {customer ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
                  <div>
                    <p className="font-medium text-slate-800">{customer.name}</p>
                    <p className="text-xs text-slate-500">
                      Balance: {formatMoney(customer.current_balance)}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setCustomer(null);
                      setCustomerQuery('');
                    }}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 focus-within:border-emerald-500">
                    <UserSearch size={18} className="text-slate-400" />
                    <input
                      value={customerQuery}
                      onFocus={() => setShowCustomerList(true)}
                      onChange={(e) => {
                        setCustomerQuery(e.target.value);
                        setShowCustomerList(true);
                      }}
                      placeholder="Search name or phone…"
                      className="flex-1 outline-none text-sm"
                    />
                  </div>
                  {showCustomerList && filteredCustomers.length > 0 && (
                    <ul className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
                      {filteredCustomers.map((c) => (
                        <li key={c.id}>
                          <button
                            onClick={() => {
                              setCustomer(c);
                              setShowCustomerList(false);
                            }}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-emerald-50 text-left text-sm"
                          >
                            <span className="font-medium text-slate-700">{c.name}</span>
                            <span className="text-xs text-slate-400">{c.phone}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 text-sm">
          <Row label="Subtotal" value={formatMoney(totals.amount)} />
          <Row label="Cost of goods" value={formatMoney(totals.cost)} muted />
          <Row
            label="Profit"
            value={`${formatMoney(totals.profit)} (${formatPercent(totals.margin)})`}
            accent
          />
          <div className="border-t border-slate-100 pt-3 mt-2 flex items-center justify-between">
            <span className="text-slate-500">Total due</span>
            <span className="text-2xl font-bold text-slate-900">{formatMoney(totals.amount)}</span>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          onClick={checkout}
          disabled={cart.length === 0 || submitting}
          className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white font-semibold py-3.5 hover:bg-emerald-700 disabled:opacity-50 transition"
        >
          {submitting ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
          {submitting ? 'Processing…' : `Charge ${formatMoney(totals.amount)}`}
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-3 shadow-lg">
          <CheckCircle2 className="text-emerald-400" size={20} /> {toast}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span
        className={
          accent ? 'font-semibold text-emerald-600' : muted ? 'text-slate-400' : 'text-slate-700'
        }
      >
        {value}
      </span>
    </div>
  );
}
