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
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { formatMoney, formatPercent, timeAgo } from '../lib/format';

interface ReceiptRow {
  total_amount: number;
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

const DAY_MS = 86_400_000;

export default function Dashboard() {
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [khata, setKhata] = useState<KhataRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const [r, k, p, c] = await Promise.all([
      supabase.from('sales_receipts').select('total_amount, created_at'),
      supabase
        .from('khata_transactions')
        .select('id, type, amount, created_at, customer_id, customers(name)')
        .order('created_at', { ascending: false })
        .limit(40),
      supabase.from('products').select('stock_quantity, low_stock_threshold'),
      supabase.from('customers').select('id, current_balance'),
    ]);
    setReceipts((r.data as ReceiptRow[]) ?? []);
    setKhata((k.data as unknown as KhataRow[]) ?? []);
    setProducts((p.data as ProductRow[]) ?? []);
    setCustomers((c.data as CustomerRow[]) ?? []);
    setLoading(false);
  }

  const metrics = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - DAY_MS;

    // --- Sales today vs yesterday + 7-day sparkline ---
    let salesToday = 0;
    let salesYesterday = 0;
    const salesByDay = sevenDayBuckets(startOfToday);
    for (const rec of receipts) {
      const t = new Date(rec.created_at).getTime();
      if (t >= startOfToday) salesToday += Number(rec.total_amount);
      else if (t >= startOfYesterday) salesYesterday += Number(rec.total_amount);
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
    };
  }, [receipts, khata, products, customers]);

  const balanceByCustomer = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of customers) m.set(c.id, Number(c.current_balance));
    return m;
  }, [customers]);

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
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
      </div>

      {/* Recent ledger activity */}
      <section className="breezy-card overflow-hidden">
        <h2 className="px-6 py-4 text-lg font-bold text-slate-800">Recent Ledger Activity</h2>
        {khata.length === 0 ? (
          <p className="px-6 pb-8 text-sm text-slate-400">
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
      </section>
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
