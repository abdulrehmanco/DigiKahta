import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Package,
  ReceiptText,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Wallet,
  Banknote,
  Lock,
  RotateCcw,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import type { PaymentMethod } from '../types';
import { formatMoney, formatPercent } from '../lib/format';

interface ReceiptRow {
  id: string;
  total_amount: number;
  total_profit: number;
  payment_method: PaymentMethod;
  created_at: string;
}
interface ItemRow {
  quantity: number;
  unit_price: number;
  unit_cost: number;
  receipt_id: string;
  product_id: string | null;
  products: { name: string } | null;
}

type Period = 'today' | 'yesterday' | '7d' | '30d' | 'all';
type Tab = 'product' | 'receipts';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All' },
];

const DAY = 86_400_000;

const PAY_ICON: Record<PaymentMethod, React.ReactNode> = {
  cash: <Banknote size={14} className="text-mint-600" />,
  card: <CreditCard size={14} className="text-sky-500" />,
  khata: <Wallet size={14} className="text-peach-400" />,
};

export default function SalesScreen() {
  const { isCashier } = useAuth();
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('today');
  const [tab, setTab] = useState<Tab>('product');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);

  useEffect(() => {
    if (isCashier) return; // owner-only screen
    void load();
  }, [isCashier]);

  async function voidSale(receiptId: string) {
    if (
      !window.confirm(
        'Void this sale? It will restock the items and reverse any khata. This cannot be undone.',
      )
    )
      return;
    setVoiding(receiptId);
    const { error } = await supabase.rpc('process_return', { p_receipt_id: receiptId });
    setVoiding(null);
    if (error) {
      window.alert(`Could not void: ${error.message}`);
      return;
    }
    setExpanded(null);
    await load();
  }

  async function load() {
    setLoading(true);
    const [{ data: r }, { data: i }] = await Promise.all([
      supabase
        .from('sales_receipts')
        .select('id, total_amount, total_profit, payment_method, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('sales_items')
        .select('quantity, unit_price, unit_cost, receipt_id, product_id, products(name)'),
    ]);
    setReceipts((r as ReceiptRow[]) ?? []);
    setItems((i as unknown as ItemRow[]) ?? []);
    setLoading(false);
  }

  // Period bounds (computed once per render; fine for this size).
  const bounds = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    switch (period) {
      case 'today':
        return { from: startOfToday, to: Infinity };
      case 'yesterday':
        return { from: startOfToday - DAY, to: startOfToday };
      case '7d':
        return { from: Date.now() - 7 * DAY, to: Infinity };
      case '30d':
        return { from: Date.now() - 30 * DAY, to: Infinity };
      default:
        return { from: 0, to: Infinity };
    }
  }, [period]);

  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= bounds.from && t < bounds.to;
  };

  const periodReceipts = useMemo(
    () => receipts.filter((r) => inRange(r.created_at)),
    [receipts, bounds],
  );
  const receiptIds = useMemo(() => new Set(periodReceipts.map((r) => r.id)), [periodReceipts]);

  // KPIs
  const kpi = useMemo(() => {
    const revenue = periodReceipts.reduce((s, r) => s + Number(r.total_amount), 0);
    const profit = periodReceipts.reduce((s, r) => s + Number(r.total_profit), 0);
    return { revenue, profit, count: periodReceipts.length, margin: revenue ? profit / revenue : 0 };
  }, [periodReceipts]);

  // By-product aggregation (only items whose receipt is in range)
  const byProduct = useMemo(() => {
    const map = new Map<
      string,
      { name: string; qty: number; revenue: number; cost: number }
    >();
    for (const it of items) {
      if (!receiptIds.has(it.receipt_id)) continue;
      const key = it.product_id ?? 'deleted';
      const name = it.products?.name ?? 'Deleted product';
      const e = map.get(key) ?? { name, qty: 0, revenue: 0, cost: 0 };
      e.qty += it.quantity;
      e.revenue += it.unit_price * it.quantity;
      e.cost += it.unit_cost * it.quantity;
      map.set(key, e);
    }
    return [...map.values()]
      .map((e) => ({ ...e, profit: e.revenue - e.cost, margin: e.revenue ? (e.revenue - e.cost) / e.revenue : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [items, receiptIds]);

  // Line items grouped by receipt (for the expandable receipts view)
  const itemsByReceipt = useMemo(() => {
    const map = new Map<string, ItemRow[]>();
    for (const it of items) {
      if (!receiptIds.has(it.receipt_id)) continue;
      const arr = map.get(it.receipt_id) ?? [];
      arr.push(it);
      map.set(it.receipt_id, arr);
    }
    return map;
  }, [items, receiptIds]);

  if (isCashier) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-24">
        <div className="h-16 w-16 rounded-2xl bg-rose-100 flex items-center justify-center mb-4">
          <Lock className="text-rose-500" size={30} />
        </div>
        <h2 className="text-xl font-bold text-slate-800">Access denied</h2>
        <p className="text-slate-500 max-w-sm mt-2">
          Sales history (with profit and margins) is restricted to shop owners.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading sales…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Period filter */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPeriod(p.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              period === p.id ? 'bg-mint-500 text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-mint-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Revenue" value={formatMoney(kpi.revenue)} />
        <Kpi label="Profit" value={formatMoney(kpi.profit)} accent />
        <Kpi label="Margin" value={formatPercent(kpi.margin)} />
        <Kpi label="Sales" value={String(kpi.count)} />
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('product')}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
            tab === 'product' ? 'bg-mint-500 text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-mint-50'
          }`}
        >
          <Package size={15} /> By product
        </button>
        <button
          type="button"
          onClick={() => setTab('receipts')}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
            tab === 'receipts' ? 'bg-mint-500 text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-mint-50'
          }`}
        >
          <ReceiptText size={15} /> Receipts ({periodReceipts.length})
        </button>
      </div>

      {kpi.count === 0 ? (
        <div className="breezy-card py-14 text-center text-slate-400">
          No sales in this period.
        </div>
      ) : tab === 'product' ? (
        <div className="breezy-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-mint-50/70 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium text-center">Qty sold</th>
                <th className="px-4 py-3 font-medium text-right">Revenue</th>
                <th className="px-4 py-3 font-medium text-right">Profit</th>
                <th className="px-4 py-3 font-medium text-right">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {byProduct.map((p, i) => (
                <tr key={i} className="hover:bg-mint-50/50">
                  <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                  <td className="px-4 py-3 text-center text-slate-700">{p.qty}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatMoney(p.revenue)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-mint-600">
                    {formatMoney(p.profit)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">{formatPercent(p.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="breezy-card divide-y divide-slate-50">
          {periodReceipts.map((r) => {
            const open = expanded === r.id;
            const lines = itemsByReceipt.get(r.id) ?? [];
            return (
              <div key={r.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : r.id)}
                  className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-mint-50/50 text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {open ? (
                      <ChevronDown size={16} className="text-slate-400 shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="text-slate-400 shrink-0" />
                    )}
                    <span className="text-sm text-slate-700">
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      {PAY_ICON[r.payment_method]}
                      {r.payment_method}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold text-slate-800">{formatMoney(r.total_amount)}</div>
                    <div className="text-xs text-mint-600">+{formatMoney(r.total_profit)} profit</div>
                  </div>
                </button>
                {open && (
                  <div className="px-10 pb-3 space-y-1">
                    {lines.map((l, idx) => (
                      <div key={idx} className="flex justify-between text-xs text-slate-500">
                        <span>
                          {l.products?.name ?? 'Deleted product'}
                          <span className="text-slate-400"> ×{l.quantity}</span>
                        </span>
                        <span>{formatMoney(l.unit_price * l.quantity)}</span>
                      </div>
                    ))}
                    {lines.length === 0 && (
                      <div className="text-xs text-slate-400">No line items recorded.</div>
                    )}
                    <button
                      type="button"
                      onClick={() => voidSale(r.id)}
                      disabled={voiding === r.id}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-rose-50 text-rose-500 px-3 py-1.5 text-xs font-semibold hover:bg-rose-100 disabled:opacity-50"
                    >
                      {voiding === r.id ? (
                        <Loader2 className="animate-spin" size={13} />
                      ) : (
                        <RotateCcw size={13} />
                      )}
                      Void sale (restock &amp; reverse)
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="breezy-card p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent ? 'text-mint-600' : 'text-slate-800'}`}>
        {value}
      </div>
    </div>
  );
}
