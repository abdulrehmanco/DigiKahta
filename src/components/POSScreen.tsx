import { useEffect, useMemo, useRef, useState, lazy, Suspense, type FormEvent } from 'react';
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
  Camera,
  PackageSearch,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import ReceiptModal, { type Receipt } from './ReceiptModal';
// Lazy-loaded: pulls in the heavy html5-qrcode library only when the camera opens.
const BarcodeScanner = lazy(() => import('./BarcodeScanner'));
import type { CartLine, Customer, PaymentMethod, Product } from '../types';
import { formatMoney, formatPercent } from '../lib/format';
import {
  cacheProducts,
  getCachedProducts,
  cacheCustomers,
  getCachedCustomers,
  enqueueSale,
  makeLocalId,
  type QueuedSale,
} from '../lib/offline';

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'khata'];

// Pastel styling per payment method — soft tints when idle, filled when selected.
const PAYMENT_STYLE: Record<PaymentMethod, { label: string; idle: string; active: string }> = {
  cash: {
    label: 'Pay by Cash',
    idle: 'bg-mint-100 text-mint-600 hover:bg-mint-200',
    active: 'bg-mint-400 text-white shadow-sm',
  },
  card: {
    label: 'Pay by Card',
    idle: 'bg-sky-100 text-sky-600 hover:bg-sky-200',
    active: 'bg-sky-400 text-white shadow-sm',
  },
  khata: {
    label: 'Pay by Udhaar',
    idle: 'bg-peach-100 text-peach-400 hover:bg-peach-200',
    active: 'bg-peach-300 text-white shadow-sm',
  },
};

export default function POSScreen() {
  const { shop } = useAuth();
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
  const [scanning, setScanning] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Latest products, readable from the scanner callback without stale closures.
  const productsRef = useRef<Product[]>([]);

  // --- data loading ---------------------------------------------------------
  useEffect(() => {
    void loadProducts();
    void loadCustomers();
    searchRef.current?.focus();
  }, []);

  async function loadProducts() {
    if (navigator.onLine) {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name', { ascending: true });
      if (!error && data) {
        const rows = data as Product[];
        setProducts(rows);
        productsRef.current = rows;
        cacheProducts(rows); // keep a local copy for offline use
        return;
      }
    }
    // Offline (or fetch failed): fall back to the cached catalog.
    const cached = getCachedProducts();
    setProducts(cached);
    productsRef.current = cached;
  }

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // Called by the camera scanner (and reusable for any barcode string).
  function addByBarcode(rawCode: string) {
    const code = rawCode.trim().toLowerCase();
    const product = productsRef.current.find((p) => p.barcode?.toLowerCase() === code);
    if (product) {
      addToCart(product);
      flashToast(`Added ${product.name}`);
    } else {
      flashToast(`No product for barcode ${rawCode}`);
    }
  }

  async function loadCustomers() {
    if (navigator.onLine) {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('name', { ascending: true });
      if (!error && data) {
        setCustomers(data as Customer[]);
        cacheCustomers(data as Customer[]);
        return;
      }
    }
    setCustomers(getCachedCustomers());
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
    const raw = query.trim();
    const q = raw.toLowerCase();
    if (!q) return;
    const exact = products.find((p) => p.barcode?.toLowerCase() === q);
    if (exact) {
      addToCart(exact);
    } else if (matches.length === 1) {
      addToCart(matches[0]);
    } else if (matches.length === 0) {
      // No hit at all — tell the cashier the product doesn't exist.
      flashToast(`Product not found: “${raw}”`);
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

    const sale: QueuedSale = {
      localId: makeLocalId(),
      created_at: new Date().toISOString(),
      payment_method: payment,
      total_amount: Number(totals.amount.toFixed(2)),
      total_profit: Number(totals.profit.toFixed(2)),
      customer_id: payment === 'khata' ? customer!.id : null,
      items: cart.map((l) => ({
        product_id: l.product.id,
        quantity: l.quantity,
        unit_price: l.product.selling_price,
        unit_cost: l.product.cost_price,
      })),
    };

    // Snapshot a receipt from the current cart BEFORE it gets cleared.
    function makeReceipt(offline: boolean): Receipt {
      return {
        shopName: shop?.name ?? 'Mizan Al-Raees',
        createdAt: sale.created_at,
        payment,
        total: sale.total_amount,
        items: cart.map((l) => ({
          name: l.product.name,
          quantity: l.quantity,
          unitPrice: l.product.selling_price,
          lineTotal: l.product.selling_price * l.quantity,
        })),
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        balanceAfter:
          payment === 'khata' && customer
            ? Number(customer.current_balance) + sale.total_amount
            : null,
        offline,
      };
    }

    function finishSale(offline: boolean) {
      setReceipt(makeReceipt(offline)); // show the receipt
      setCart([]);
      setPayment('cash');
      setCustomer(null);
      setCustomerQuery('');
    }

    async function queueOffline() {
      enqueueSale(sale);
      await loadProducts(); // reflect optimistic stock/balance from cache
      await loadCustomers();
      finishSale(true);
    }

    // Offline → queue it locally and apply optimistically. It syncs on reconnect.
    if (!navigator.onLine) {
      await queueOffline();
      return;
    }

    setSubmitting(true);
    try {
      // A dropped connection often makes supabase-js THROW ("Failed to fetch")
      // rather than return an error — so we wrap and treat both as offline.
      const { error: rpcError } = await supabase.rpc('process_sale', {
        p_payment_method: sale.payment_method,
        p_total_amount: sale.total_amount,
        p_total_profit: sale.total_profit,
        p_items: sale.items,
        p_customer_id: sale.customer_id,
      });
      if (rpcError) throw rpcError;

      await loadProducts(); // refresh stock counts
      await loadCustomers(); // refresh balances
      finishSale(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Network/connectivity failure → queue offline instead of losing the sale.
      if (!navigator.onLine || /failed to fetch|networkerror|fetch/i.test(msg)) {
        await queueOffline();
      } else {
        // A genuine server rejection (e.g. inactive shop) — surface it.
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
      {/* ---- Left: search + cart ---- */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        <form onSubmit={handleScan} className="relative">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1 rounded-full bg-white/90 backdrop-blur border border-white px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-mint-200">
              <ScanLine className="text-mint-600" size={22} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Scan barcode (USB) or search product name…"
                className="flex-1 bg-transparent outline-none text-slate-800 placeholder:text-slate-400"
              />
            </div>
            <button
              type="button"
              onClick={() => setScanning(true)}
              className="flex items-center gap-2 rounded-full bg-mint-500 text-white px-5 py-3 font-semibold hover:bg-mint-600 shrink-0 shadow-sm"
              title="Scan with camera"
            >
              <Camera size={20} />
              <span className="hidden sm:inline">Scan</span>
            </button>
          </div>
          {matches.length > 0 && (
            <ul className="absolute z-20 mt-2 w-full rounded-2xl border border-white bg-white shadow-lg overflow-hidden">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => addToCart(p)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-mint-50 text-left"
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
          {query.trim() && matches.length === 0 && (
            <div className="absolute z-20 mt-2 w-full rounded-2xl border border-white bg-white shadow-lg px-4 py-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-peach-100 flex items-center justify-center shrink-0">
                <PackageSearch className="text-peach-400" size={20} />
              </div>
              <div>
                <p className="font-semibold text-slate-700 text-sm">Product does not exist</p>
                <p className="text-xs text-slate-400">
                  No item matches “{query.trim()}”. Check the barcode/name, or add it in Inventory.
                </p>
              </div>
            </div>
          )}
        </form>

        <div className="flex-1 breezy-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-5 py-4">
            <h3 className="flex items-center gap-2 text-slate-800 font-bold">
              <ShoppingCart size={18} className="text-mint-600" /> Active Sales Cart
            </h3>
            <span className="text-xs font-medium text-slate-400">{cart.length} item(s)</span>
          </div>

          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 text-sm py-16 px-6">
              <div className="h-12 w-12 rounded-2xl bg-mint-100 flex items-center justify-center mb-3">
                <ScanLine className="text-mint-600" size={22} />
              </div>
              <p className="font-medium text-slate-500">Ready to Scan</p>
              <p className="text-xs mt-1">
                Use your camera or hardware scanner. Press &lsquo;Enter&rsquo; after scanning.
              </p>
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

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setQty(line.product.id, line.quantity - 1)}
                      className="h-8 w-8 rounded-full bg-mint-100 text-mint-600 hover:bg-mint-200 flex items-center justify-center"
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
                      className="w-11 text-center rounded-lg border border-slate-200 py-1"
                    />
                    <button
                      type="button"
                      onClick={() => setQty(line.product.id, line.quantity + 1)}
                      className="h-8 w-8 rounded-full bg-peach-200 text-peach-400 hover:bg-peach-300 flex items-center justify-center"
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
        <div className="breezy-card p-5 space-y-4">
          <h3 className="font-bold text-slate-800">POS Controls &amp; Payment</h3>

          <div className="grid grid-cols-2 gap-2.5">
            {PAYMENT_METHODS.map((m) => {
              const cfg = PAYMENT_STYLE[m];
              const selected = payment === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayment(m)}
                  className={`pill-btn ${m === 'khata' ? 'col-span-2' : ''} ${
                    selected ? cfg.active : cfg.idle
                  }`}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>

          {payment === 'khata' && (
            <div className="relative">
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Customer (required)
              </label>
              {customer ? (
                <div className="flex items-center justify-between rounded-xl border border-mint-200 bg-mint-50 px-3 py-2">
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
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 focus-within:ring-2 focus-within:ring-mint-200">
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
                    <ul className="absolute z-20 mt-1 w-full rounded-xl border border-white bg-white shadow-lg overflow-hidden">
                      {filteredCustomers.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomer(c);
                              setShowCustomerList(false);
                            }}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-mint-50 text-left text-sm"
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

        <div className="breezy-card p-5 space-y-2 text-sm">
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
          <p className="text-sm text-rose-500 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={checkout}
          disabled={cart.length === 0 || submitting}
          className="flex items-center justify-center gap-2 rounded-full bg-peach-300 text-white font-semibold py-3.5 hover:bg-peach-400 disabled:opacity-50 transition shadow-sm active:scale-[0.98]"
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

      {scanning && (
        <Suspense fallback={null}>
          <BarcodeScanner onDetect={addByBarcode} onClose={() => setScanning(false)} />
        </Suspense>
      )}

      {receipt && (
        <ReceiptModal
          receipt={receipt}
          onClose={() => {
            setReceipt(null);
            searchRef.current?.focus();
          }}
        />
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
