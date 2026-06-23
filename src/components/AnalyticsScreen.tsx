import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import {
  Lock,
  TrendingUp,
  Clock,
  Trophy,
  Boxes,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Scale,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import type { SalesReceipt } from '../types';
import { formatMoney, formatPercent } from '../lib/format';

interface ItemRow {
  quantity: number;
  unit_price: number;
  unit_cost: number;
  product_id: string | null;
  products: { name: string } | null;
}
interface ExpenseRow {
  amount: number;
  created_at: string;
}

export default function AnalyticsScreen() {
  const { isCashier } = useAuth();
  const [receipts, setReceipts] = useState<SalesReceipt[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isCashier) return; // don't even fetch for cashiers
    void load();
  }, [isCashier]);

  async function load() {
    setLoading(true);
    const [{ data: r }, { data: i }, { data: e }] = await Promise.all([
      supabase.from('sales_receipts').select('*').order('created_at', { ascending: true }),
      supabase
        .from('sales_items')
        .select('quantity, unit_price, unit_cost, product_id, products(name)'),
      supabase.from('expenses').select('amount, created_at'),
    ]);
    setReceipts((r as SalesReceipt[]) ?? []);
    setItems((i as unknown as ItemRow[]) ?? []);
    setExpenses((e as ExpenseRow[]) ?? []);
    setLoading(false);
  }

  // ---- Access control ------------------------------------------------------
  if (isCashier) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-24">
        <div className="h-16 w-16 rounded-2xl bg-red-100 flex items-center justify-center mb-4">
          <Lock className="text-red-500" size={30} />
        </div>
        <h2 className="text-xl font-bold text-slate-800">Access denied</h2>
        <p className="text-slate-500 max-w-sm mt-2">
          The Business Advisor dashboard is restricted to shop owners. Ask an owner to sign in to
          view analytics.
        </p>
      </div>
    );
  }

  // ---- Peak business hours -------------------------------------------------
  const hourly = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: hourLabel(h), count: 0 }));
    for (const r of receipts) {
      const h = new Date(r.created_at).getHours();
      buckets[h].count += 1;
    }
    return buckets;
  }, [receipts]);

  // ---- Top products by margin & by volume ----------------------------------
  const { topMargin, topVolume } = useMemo(() => {
    const map = new Map<string, { name: string; margin: number; volume: number }>();
    for (const it of items) {
      const key = it.product_id ?? 'unknown';
      const name = it.products?.name ?? 'Deleted product';
      const entry = map.get(key) ?? { name, margin: 0, volume: 0 };
      entry.margin += (it.unit_price - it.unit_cost) * it.quantity;
      entry.volume += it.quantity;
      map.set(key, entry);
    }
    const all = [...map.values()];
    return {
      topMargin: [...all].sort((a, b) => b.margin - a.margin).slice(0, 5),
      topVolume: [...all].sort((a, b) => b.volume - a.volume).slice(0, 5),
    };
  }, [items]);

  // ---- Revenue vs Expenses, last 6 months ----------------------------------
  const monthly = useMemo(() => {
    const now = new Date();
    const months: {
      key: string;
      label: string;
      revenue: number;
      expenses: number;
      gross: number;
      net: number;
    }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleString('en', { month: 'short' }),
        revenue: 0,
        expenses: 0,
        gross: 0,
        net: 0,
      });
    }
    const idx = new Map(months.map((m, i) => [m.key, i]));
    const keyOf = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${d.getMonth()}`;
    };
    for (const r of receipts) {
      const i = idx.get(keyOf(r.created_at));
      if (i !== undefined) {
        months[i].revenue += Number(r.total_amount);
        months[i].gross += Number(r.total_profit);
      }
    }
    for (const e of expenses) {
      const i = idx.get(keyOf(e.created_at));
      if (i !== undefined) months[i].expenses += Number(e.amount);
    }
    for (const m of months) m.net = m.gross - m.expenses;
    return months;
  }, [receipts, expenses]);

  // ---- Sales projection ----------------------------------------------------
  const projection = useMemo(() => buildProjection(receipts), [receipts]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} /> Crunching numbers…
      </div>
    );
  }

  const totalRevenue = receipts.reduce((s, r) => s + Number(r.total_amount), 0);
  const totalProfit = receipts.reduce((s, r) => s + Number(r.total_profit), 0);
  const totalCost = totalRevenue - totalProfit;
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const netProfit = totalProfit - totalExpenses;

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Kpi label="Total revenue" value={formatMoney(totalRevenue)} />
        <Kpi label="Total cost" value={formatMoney(totalCost)} />
        <Kpi label="Gross profit" value={formatMoney(totalProfit)} />
        <Kpi label="Expenses" value={formatMoney(totalExpenses)} />
        <Kpi label="Net profit" value={formatMoney(netProfit)} accent />
        <Kpi
          label="Avg. margin"
          value={formatPercent(totalRevenue ? totalProfit / totalRevenue : 0)}
        />
      </div>

      {/* Projection card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 text-slate-700 font-semibold mb-4">
          <TrendingUp size={18} className="text-emerald-600" /> Sales projection — this month
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ProjectionStat label="So far this month" value={formatMoney(projection.monthToDate)} />
          <ProjectionStat
            label={`Projected (${projection.daysInMonth} days)`}
            value={formatMoney(projection.projectedTotal)}
          />
          <ProjectionStat
            label="vs. prior weeks' pace"
            value={formatPercent(Math.abs(projection.trajectory))}
            trend={projection.trajectory}
          />
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Projection extrapolates the current month's daily run-rate ({formatMoney(projection.dailyRate)}/day)
          across all {projection.daysInMonth} days, then compares it to the average weekly pace of the
          preceding weeks.
        </p>
      </div>

      {/* Revenue vs Expenses vs Net profit */}
      <ChartCard title="Revenue · Expenses · Net profit (last 6 months)" icon={<Scale size={18} />}>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={monthly} margin={{ top: 10, right: 20, bottom: 0, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <Tooltip
              formatter={(v, name) => [
                formatMoney(Number(v)),
                name === 'revenue' ? 'Revenue' : name === 'expenses' ? 'Expenses' : 'Net profit',
              ]}
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
            />
            <Bar dataKey="revenue" name="revenue" fill="#34d399" radius={[6, 6, 0, 0]} />
            <Bar dataKey="expenses" name="expenses" fill="#fda4af" radius={[6, 6, 0, 0]} />
            <Line
              type="monotone"
              dataKey="net"
              name="net"
              stroke="#0f172a"
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap items-center justify-center gap-5 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-mint-400" /> Revenue
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-coral-300" /> Expenses
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-900" /> Net profit
          </span>
        </div>
      </ChartCard>

      {/* Peak hours */}
      <ChartCard title="Peak business hours" icon={<Clock size={18} />}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={hourly} margin={{ top: 10, right: 20, bottom: 0, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} interval={1} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <Tooltip
              formatter={(v) => [`${Number(v)} sales`, 'Transactions']}
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke="#059669"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Top products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Top 5 high-margin products" icon={<Trophy size={18} />}>
          <ProductBars data={topMargin} dataKey="margin" color="#059669" money />
        </ChartCard>
        <ChartCard title="Top 5 high-volume products" icon={<Boxes size={18} />}>
          <ProductBars data={topVolume} dataKey="volume" color="#6366f1" />
        </ChartCard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers & sub-components
// ---------------------------------------------------------------------------

function hourLabel(h: number): string {
  const period = h < 12 ? 'a' : 'p';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${period}`;
}

function buildProjection(receipts: SalesReceipt[]) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayOfMonth = now.getDate();

  let monthToDate = 0;
  const priorByDay: number[] = [];

  for (const r of receipts) {
    const d = new Date(r.created_at);
    const amt = Number(r.total_amount);
    if (d.getFullYear() === year && d.getMonth() === month) {
      monthToDate += amt;
    } else if (d < new Date(year, month, 1)) {
      priorByDay.push(amt);
    }
  }

  const dailyRate = dayOfMonth > 0 ? monthToDate / dayOfMonth : 0;
  const projectedTotal = dailyRate * daysInMonth;

  // Prior pace: total of all earlier sales spread over the number of distinct
  // earlier days we observed, scaled to a comparable monthly figure.
  const priorTotal = priorByDay.reduce((s, v) => s + v, 0);
  const priorDailyAvg = priorByDay.length ? priorTotal / Math.max(28, priorByDay.length) : dailyRate;
  const priorMonthly = priorDailyAvg * daysInMonth;

  const trajectory = priorMonthly > 0 ? (projectedTotal - priorMonthly) / priorMonthly : 0;

  return { monthToDate, projectedTotal, dailyRate, daysInMonth, trajectory };
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent ? 'text-emerald-600' : 'text-slate-800'}`}>
        {value}
      </div>
    </div>
  );
}

function ProjectionStat({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend?: number;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-xl font-bold text-slate-800 mt-1 flex items-center gap-1">
        {trend !== undefined &&
          (trend >= 0 ? (
            <ArrowUpRight className="text-emerald-600" size={18} />
          ) : (
            <ArrowDownRight className="text-red-500" size={18} />
          ))}
        <span className={trend !== undefined ? (trend >= 0 ? 'text-emerald-600' : 'text-red-500') : ''}>
          {value}
        </span>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 text-slate-700 font-semibold mb-4">
        <span className="text-emerald-600">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function ProductBars({
  data,
  dataKey,
  color,
  money,
}: {
  data: { name: string; margin: number; volume: number }[];
  dataKey: 'margin' | 'volume';
  color: string;
  money?: boolean;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-slate-400 py-12 text-center">No sales recorded yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={{ fontSize: 11, fill: '#475569' }}
        />
        <Tooltip
          formatter={(v) => [money ? formatMoney(Number(v)) : `${Number(v)} units`, dataKey]}
          contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
        />
        <Bar dataKey={dataKey} radius={[0, 6, 6, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
