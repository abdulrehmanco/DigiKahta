import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Boxes,
  Loader2,
  ArrowUpRight,
  ArrowDownLeft,
  Banknote,
  CreditCard,
  ChevronDown,
  ChevronUp,
  X,
  Scale,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import type { PaymentMethod } from '../types';
import { formatMoney, formatPercent, timeAgo } from '../lib/format';

interface ReceiptRow {
  id: string;
  total_amount: number;
  total_profit: number;
  payment_method: PaymentMethod;
  created_at: string;
}
interface KhataRow {
  id: string;
  type: 'charge' | 'payment';
  amount: number;
  created_at: string;
  customer_id: string;
  customers: { name: string } | null;
}
interface ProductRow {
  stock_quantity: number;
  low_stock_threshold: number;
}
interface CustomerRow {
  id: string;
  current_balance: number;
}
interface ExpenseRow {
  id: string;
  amount: number;
  category: string | null;
  note: string | null;
  created_at: string;
}
interface SaleItemRow {
  quantity: number;
  unit_price: number;
  receipt_id: string;
  products: { name: string } | null;
}

const DAY_MS = 86_400_000;

const PAY_ICON: Record<PaymentMethod, React.ReactNode> = {
  cash: <Banknote size={14} className="text-mint-600" />,
  card: <CreditCard size={14} className="text-sky-500" />,
  khata: <Wallet size={14} className="text-peach-400" />,
};

export default function Dashboard() {
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [khata, setKhata] = useState<KhataRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSale, setOpenSale] = useState<ReceiptRow | null>(null);
  const [showSales, setShowSales] = useState(true);
  const [showLedger, setShowLedger] = useState(true);
  const [showExpenses, setShowExpenses] = useState(true);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const [r, k, p, c, e, si] = await Promise.all([
      supabase
        .from('sales_receipts')
        .select('id, total_amount, total_profit, payment_method, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('khata_transactions')
        .select('id, type, amount, created_at, customer_id, customers(name)')
        .order('created_at', { ascending: false })
        .limit(40),
      supabase.from('products').select('stock_quantity, low_stock_threshold'),
      supabase.from('customers').select('id, current_balance'),
      supabase
        .from('expenses')
        .select('id, amount, category, note, created_at')
        .order('created_at', { ascending: false }),
      supabase.from('sales_items').select('quantity, unit_price, receipt_id, products(name)'),
    ]);
    setReceipts((r.data as ReceiptRow[]) ?? []);
    setKhata((k.data as unknown as KhataRow[]) ?? []);
    setProducts((p.data as ProductRow[]) ?? []);
    setCustomers((c.data as CustomerRow[]) ?? []);
    setExpenses((e.data as ExpenseRow[]) ?? []);
    setSaleItems((si.data as unknown as SaleItemRow[]) ?? []);
    setLoading(false);
  }

  const metrics = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - DAY_MS;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    // --- Sales today vs yesterday + 7-day sparkline + month income ---
    let salesToday = 0;
    let salesYesterday = 0;
    let revenueMonth = 0;
    let grossProfitMonth = 0;
    const salesByDay = sevenDayBuckets(startOfToday);
    for (const rec of receipts) {
      const t = new Date(rec.created_at).getTime();
      if (t >= startOfToday) salesToday += Number(rec.total_amount);
      else if (t >= startOfYesterday) salesYesterday += Number(rec.total_amount);
      if (t >= startOfMonth) {
        revenueMonth += Number(rec.total_amount);
        grossProfitMonth += Number(rec.total_profit);
      }
      addToBucket(salesByDay, t, Number(rec.total_amount), startOfToday);
    }
    const salesDelta =
      salesYesterday > 0 ? (salesToday - salesYesterday) / salesYesterday : null;

    // --- Outstanding udhaar + 7-day net-credit sparkline ---
    const totalOutstanding = customers.reduce((s, c) => s + Number(c.current_balance), 0);
    const creditByDay = sevenDayBuckets(startOfToday);
    let chargesToday = 0;
    let chargesPrev = 0;
    for (const tx of khata) {
      const t = new Date(tx.created_at).getTime();
      const signed = tx.type === 'charge' ? Number(tx.amount) : -Number(tx.amount);
      addToBucket(creditByDay, t, signed, startOfToday);
      if (tx.type === 'charge') {
        if (t >= startOfToday) chargesToday += Number(tx.amount);
        else if (t >= startOfYesterday) chargesPrev += Number(tx.amount);
      }
    }
    const creditDelta = chargesPrev > 0 ? (chargesToday - chargesPrev) / chargesPrev : null;

    // --- Stock ---
    const productCount = products.length;
    const lowCount = products.filter(
      (p) => p.stock_quantity <= p.low_stock_threshold,
    ).length;
    const inStock = productCount - lowCount;
    const stockHealth = productCount > 0 ? inStock / productCount : 1;
    // Sparkline = daily receipt count (sales activity ≈ stock movement).
    const activityByDay = sevenDayBuckets(startOfToday);
    for (const rec of receipts) {
      addToBucket(activityByDay, new Date(rec.created_at).getTime(), 1, startOfToday);
    }

    // --- Expenses this month vs last month + 7-day sparkline ---
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    let expenseMonth = 0;
    let expenseLastMonth = 0;
    const expenseByDay = sevenDayBuckets(startOfToday);
    for (const ex of expenses) {
      const t = new Date(ex.created_at).getTime();
      const amt = Number(ex.amount);
      if (t >= startOfMonth) expenseMonth += amt;
      else if (t >= startOfLastMonth) expenseLastMonth += amt;
      addToBucket(expenseByDay, t, amt, startOfToday);
    }
    const expenseDelta =
      expenseLastMonth > 0 ? (expenseMonth - expenseLastMonth) / expenseLastMonth : null;

    return {
      salesToday,
      salesDelta,
      salesByDay,
      totalOutstanding,
      creditDelta,
      creditByDay,
      productCount,
      lowCount,
      stockHealth,
      activityByDay,
      expenseMonth,
      expenseDelta,
      expenseByDay,
      // income summary (month-to-date)
      revenueMonth,
      cogsMonth: revenueMonth - grossProfitMonth,
      grossProfitMonth,
      netProfitMonth: grossProfitMonth - expenseMonth,
    };
  }, [receipts, khata, products, customers, expenses]);

  const balanceByCustomer = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of customers) m.set(c.id, Number(c.current_balance));
    return m;
  }, [customers]);

  // Line items grouped by receipt, for the recent-sales product column + popup.
  const itemsByReceipt = useMemo(() => {
    const m = new Map<string, SaleItemRow[]>();
    for (const it of saleItems) {
      const arr = m.get(it.receipt_id) ?? [];
      arr.push(it);
      m.set(it.receipt_id, arr);
    }
    return m;
  }, [saleItems]);

  function productNames(receiptId: string): string {
    const items = itemsByReceipt.get(receiptId) ?? [];
    if (items.length === 0) return '—';
    const names = items.map((i) => i.products?.name ?? 'Item');
    const shown = names.slice(0, 2).join(', ');
    return names.length > 2 ? `${shown}, +${names.length - 2} more` : shown;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard
          title="Total Sales Today"
          value={formatMoney(metrics.salesToday)}
          delta={metrics.salesDelta}
          data={metrics.salesByDay}
          stroke="#34d399"
          fill="#a1ded6"
          icon={<TrendingUp size={18} />}
        />
        <MetricCard
          title="Total Udhaar (Credit)"
          value={formatMoney(metrics.totalOutstanding)}
          delta={metrics.creditDelta}
          deltaInverse
          data={metrics.creditByDay}
          stroke="#10b981"
          fill="#6ee7b7"
          icon={<Wallet size={18} />}
        />
        <MetricCard
          title="Products in Stock"
          value={String(metrics.productCount)}
          subtitle={
            metrics.lowCount > 0
              ? `${metrics.lowCount} low · ${formatPercent(metrics.stockHealth)} healthy`
              : `${formatPercent(metrics.stockHealth)} healthy`
          }
          data={metrics.activityByDay}
          stroke="#fb923c"
          fill="#fdba74"
          icon={<Boxes size={18} />}
        />
        <MetricCard
          title="Expenses (this month)"
          value={formatMoney(metrics.expenseMonth)}
          delta={metrics.expenseDelta}
          deltaInverse
          data={metrics.expenseByDay}
          stroke="#f43f5e"
          fill="#fda4af"
          icon={<Wallet size={18} />}
        />
      </div>

      {/* Income summary — the real "what did I earn" picture */}
      {(() => {
        const net = metrics.netProfitMonth;
        const positive = net >= 0;
        return (
          <div className="breezy-card p-6">
            <div className="flex items-center gap-2 text-slate-800 font-bold mb-5">
              <Scale size={18} className="text-mint-600" /> This Month — Income Summary
            </div>

            <div className="grid md:grid-cols-2 gap-6 items-stretch">
              {/* Breakdown */}
              <div className="space-y-2.5 text-sm">
                <SummaryRow label="Revenue" value={formatMoney(metrics.revenueMonth)} />
                <SummaryRow label="− Cost of goods" value={formatMoney(metrics.cogsMonth)} muted />
                <div className="border-t border-slate-100 pt-2.5">
                  <SummaryRow
                    label="Gross profit"
                    value={formatMoney(metrics.grossProfitMonth)}
                    strong
                  />
                </div>
                <SummaryRow label="− Expenses" value={formatMoney(metrics.expenseMonth)} muted />
              </div>

              {/* Net profit / loss highlight */}
              <div
                className={`rounded-2xl p-6 flex flex-col justify-center ${
                  positive ? 'bg-mint-50' : 'bg-rose-50'
                }`}
              >
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-500">
                  {positive ? (
                    <TrendingUp size={16} className="text-mint-600" />
                  ) : (
                    <TrendingDown size={16} className="text-rose-500" />
                  )}
                  {positive ? 'Net profit this month' : 'Net loss this month'}
                </div>
                <div
                  className={`text-4xl font-bold mt-1 ${
                    positive ? 'text-mint-600' : 'text-rose-500'
                  }`}
                >
                  {positive ? '' : '−'}
                  {formatMoney(Math.abs(net))}
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Revenue − cost of goods − shop expenses.
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Recent sales */}
      <CollapsibleSection
        title="Recent Sales"
        open={showSales}
        onToggle={() => setShowSales((v) => !v)}
      >
        {receipts.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-slate-400">
            No sales yet. Completed sales will appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left border-y border-slate-100">
                <tr>
                  <th className="px-6 py-3 font-medium">Products</th>
                  <th className="px-6 py-3 font-medium">Payment</th>
                  <th className="px-6 py-3 font-medium text-right">Total</th>
                  <th className="px-6 py-3 font-medium text-right">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {receipts.slice(0, 8).map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setOpenSale(r)}
                    className="hover:bg-mint-50/60 cursor-pointer"
                  >
                    <td className="px-6 py-3 max-w-[260px]">
                      <div className="font-medium text-slate-800 truncate">
                        {productNames(r.id)}
                      </div>
                      <div className="text-[11px] text-slate-400">{timeAgo(r.created_at)}</div>
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 capitalize">
                        {PAY_ICON[r.payment_method]}
                        {r.payment_method}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right font-semibold text-slate-700">
                      {formatMoney(Number(r.total_amount))}
                    </td>
                    <td className="px-6 py-3 text-right text-mint-600">
                      +{formatMoney(Number(r.total_profit))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      {/* Recent ledger activity */}
      <CollapsibleSection
        title="Recent Ledger Activity"
        open={showLedger}
        onToggle={() => setShowLedger((v) => !v)}
      >
        {khata.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-slate-400">
            No ledger activity yet. Udhaar charges and payments will appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left border-y border-slate-100">
                <tr>
                  <th className="px-6 py-3 font-medium">Customer Name</th>
                  <th className="px-6 py-3 font-medium">Transaction Type</th>
                  <th className="px-6 py-3 font-medium text-right">Amount</th>
                  <th className="px-6 py-3 font-medium text-right">Balance</th>
                  <th className="px-6 py-3 font-medium text-right">Date/Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {khata.slice(0, 8).map((tx) => {
                  const isCharge = tx.type === 'charge';
                  return (
                    <tr key={tx.id} className="hover:bg-mint-50/60">
                      <td className="px-6 py-3.5 font-medium text-slate-700">
                        {tx.customers?.name ?? 'Unknown'}
                      </td>
                      <td className="px-6 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                            isCharge
                              ? 'bg-peach-100 text-peach-400'
                              : 'bg-mint-100 text-mint-600'
                          }`}
                        >
                          {isCharge ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
                          {isCharge ? 'Udhaar (Debit)' : 'Payment'}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right font-semibold text-slate-700">
                        {formatMoney(Number(tx.amount))}
                      </td>
                      <td className="px-6 py-3.5 text-right text-slate-500">
                        {formatMoney(balanceByCustomer.get(tx.customer_id) ?? 0)}
                      </td>
                      <td className="px-6 py-3.5 text-right text-slate-400">
                        {timeAgo(tx.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      {/* Recent expenses */}
      <CollapsibleSection
        title="Recent Expenses"
        open={showExpenses}
        onToggle={() => setShowExpenses((v) => !v)}
      >
        {expenses.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-slate-400">
            No expenses recorded yet. Add shop costs in Ledger → Expenses.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left border-y border-slate-100">
                <tr>
                  <th className="px-6 py-3 font-medium">Category</th>
                  <th className="px-6 py-3 font-medium">Note</th>
                  <th className="px-6 py-3 font-medium text-right">Amount</th>
                  <th className="px-6 py-3 font-medium text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {expenses.slice(0, 8).map((ex) => (
                  <tr key={ex.id} className="hover:bg-mint-50/60">
                    <td className="px-6 py-3.5 font-medium text-slate-700">
                      {ex.category ?? 'Expense'}
                    </td>
                    <td className="px-6 py-3.5 text-slate-500 max-w-[220px] truncate">
                      {ex.note ?? '—'}
                    </td>
                    <td className="px-6 py-3.5 text-right font-semibold text-rose-500">
                      −{formatMoney(Number(ex.amount))}
                    </td>
                    <td className="px-6 py-3.5 text-right text-slate-400">
                      {timeAgo(ex.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      {openSale && (
        <SaleDetailModal
          receipt={openSale}
          items={itemsByReceipt.get(openSale.id) ?? []}
          onClose={() => setOpenSale(null)}
        />
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? 'text-slate-400' : 'text-slate-500'}>{label}</span>
      <span className={strong ? 'font-semibold text-slate-800' : muted ? 'text-slate-400' : 'text-slate-700'}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="breezy-card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-mint-50/40"
      >
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        {open ? (
          <ChevronUp size={18} className="text-slate-400" />
        ) : (
          <ChevronDown size={18} className="text-slate-400" />
        )}
      </button>
      {open && children}
    </section>
  );
}

function SaleDetailModal({
  receipt,
  items,
  onClose,
}: {
  receipt: ReceiptRow;
  items: SaleItemRow[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-slate-800">Sale details</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          {new Date(receipt.created_at).toLocaleString()} · {receipt.payment_method}
        </p>

        <ul className="space-y-2">
          {items.length === 0 && (
            <li className="text-sm text-slate-400">No line items recorded.</li>
          )}
          {items.map((it, idx) => (
            <li key={idx} className="flex justify-between text-sm">
              <span className="text-slate-700">
                {it.products?.name ?? 'Item'}
                <span className="text-slate-400"> ×{it.quantity}</span>
              </span>
              <span className="text-slate-600">{formatMoney(it.unit_price * it.quantity)}</span>
            </li>
          ))}
        </ul>

        <div className="border-t border-slate-100 mt-4 pt-3 flex items-center justify-between">
          <span className="text-slate-500">Total</span>
          <span className="text-xl font-bold text-slate-900">
            {formatMoney(Number(receipt.total_amount))}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-mint-600 mt-1">
          <span>Profit</span>
          <span>+{formatMoney(Number(receipt.total_profit))}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sevenDayBuckets(startOfToday: number): { v: number }[] {
  return Array.from({ length: 7 }, () => ({ v: 0 }));
  // index 0 = 6 days ago … index 6 = today (see addToBucket)
  void startOfToday;
}

function addToBucket(
  buckets: { v: number }[],
  timestamp: number,
  amount: number,
  startOfToday: number,
) {
  const daysAgo = Math.floor((startOfToday - timestamp) / DAY_MS);
  if (daysAgo < 0) {
    buckets[6].v += amount; // today
  } else if (daysAgo <= 6) {
    buckets[6 - daysAgo].v += amount;
  }
}

function MetricCard({
  title,
  value,
  subtitle,
  delta,
  deltaInverse,
  data,
  stroke,
  fill,
  icon,
}: {
  title: string;
  value: string;
  subtitle?: string;
  delta?: number | null;
  deltaInverse?: boolean;
  data: { v: number }[];
  stroke: string;
  fill: string;
  icon: React.ReactNode;
}) {
  const gradId = `grad-${title.replace(/\s+/g, '')}`;
  const showDelta = delta !== null && delta !== undefined;
  // For udhaar, a rise is "bad" → invert the colour meaning.
  const positive = showDelta ? (deltaInverse ? delta! <= 0 : delta! >= 0) : true;

  return (
    <div className="breezy-card p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
          <span className="text-slate-400">{icon}</span>
          {title}
        </div>
      </div>

      <div className="mt-2 flex items-end gap-2">
        <div className="text-3xl font-bold text-slate-800">{value}</div>
        {showDelta && (
          <span
            className={`mb-1 inline-flex items-center gap-0.5 text-xs font-semibold ${
              positive ? 'text-mint-600' : 'text-rose-400'
            }`}
          >
            {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {formatPercent(Math.abs(delta!))}
          </span>
        )}
      </div>

      {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}

      <div className="h-12 mt-3 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={fill} stopOpacity={0.7} />
                <stop offset="100%" stopColor={fill} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="v"
              stroke={stroke}
              strokeWidth={2.5}
              fill={`url(#${gradId})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
