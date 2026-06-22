import { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  CalendarClock,
  Archive,
  Loader2,
  MessageCircle,
  TrendingDown,
  Tag,
  RotateCcw,
  PackageCheck,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import type { Product } from '../types';
import { formatMoney, daysUntil } from '../lib/format';

// Tunable planning windows.
const WINDOW_DAYS = 30; // sales history used to measure velocity
const LEAD_DAYS = 14; // reorder when stock will run out within this many days
const COVER_DAYS = 30; // order enough to cover this many days of sales
const EXPIRY_WINDOW = 60; // flag items expiring within this many days

interface ItemRow {
  quantity: number;
  product_id: string | null;
  sales_receipts: { created_at: string } | null;
}

interface ReorderItem {
  p: Product;
  velocity: number; // units/day
  daysLeft: number;
  suggestQty: number;
  cost: number;
}
interface ExpiringItem {
  p: Product;
  dte: number;
  valueAtRisk: number;
  discount: number;
  newPrice: number;
}
interface DeadItem {
  p: Product;
  capital: number;
}

type Tab = 'reorder' | 'expiring' | 'dead';

export default function RestockScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('reorder');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: p }, { data: i }] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('sales_items').select('quantity, product_id, sales_receipts(created_at)'),
    ]);
    setProducts((p as Product[]) ?? []);
    setItems((i as unknown as ItemRow[]) ?? []);
    setLoading(false);
  }

  const { reorder, expiring, dead } = useMemo(() => {
    const windowStart = Date.now() - WINDOW_DAYS * 86_400_000;

    // Units sold per product within the window.
    const sold = new Map<string, number>();
    for (const it of items) {
      const t = it.sales_receipts?.created_at
        ? new Date(it.sales_receipts.created_at).getTime()
        : 0;
      if (t >= windowStart && it.product_id) {
        sold.set(it.product_id, (sold.get(it.product_id) ?? 0) + it.quantity);
      }
    }

    const reorder: ReorderItem[] = [];
    const expiring: ExpiringItem[] = [];
    const dead: DeadItem[] = [];

    for (const p of products) {
      const unitsSold = sold.get(p.id) ?? 0;
      const velocity = unitsSold / WINDOW_DAYS;
      const daysLeft = velocity > 0 ? p.stock_quantity / velocity : Infinity;

      // --- Reorder: low now, or projected to run out within the lead time ---
      const target = Math.max(p.low_stock_threshold, Math.ceil(velocity * COVER_DAYS));
      const suggestQty = Math.max(0, target - p.stock_quantity);
      if (suggestQty > 0 && (p.stock_quantity <= p.low_stock_threshold || daysLeft <= LEAD_DAYS)) {
        reorder.push({ p, velocity, daysLeft, suggestQty, cost: suggestQty * p.cost_price });
      }

      // --- Expiring: at risk + a markdown suggestion scaled to urgency ---
      const dte = daysUntil(p.expiry_date);
      if (dte !== null && dte <= EXPIRY_WINDOW && p.stock_quantity > 0) {
        const discount = dte < 0 ? 0.6 : dte <= 7 ? 0.5 : dte <= 15 ? 0.3 : dte <= 30 ? 0.2 : 0.1;
        const newPrice = Math.round(p.selling_price * (1 - discount));
        expiring.push({ p, dte, valueAtRisk: p.stock_quantity * p.cost_price, discount, newPrice });
      }

      // --- Dead stock: in stock but zero sales across the whole window ---
      if (p.stock_quantity > 0 && unitsSold === 0) {
        dead.push({ p, capital: p.stock_quantity * p.cost_price });
      }
    }

    reorder.sort((a, b) => a.daysLeft - b.daysLeft);
    expiring.sort((a, b) => a.dte - b.dte);
    dead.sort((a, b) => b.capital - a.capital);
    return { reorder, expiring, dead };
  }, [products, items]);

  const expiringRisk = expiring.reduce((s, e) => s + e.valueAtRisk, 0);
  const deadCapital = dead.reduce((s, d) => s + d.capital, 0);
  const reorderCost = reorder.reduce((s, r) => s + r.cost, 0);

  // Pre-filled WhatsApp purchase order (no fixed number — pick the supplier).
  const orderHref = useMemo(() => {
    if (reorder.length === 0) return '';
    const lines = reorder.map((r) => `• ${r.p.name} — ${r.suggestQty} pcs`).join('\n');
    const msg =
      `*Purchase Order*\n${lines}\n\nItems: ${reorder.length}\n` +
      `Est. cost: ${formatMoney(reorderCost)}`;
    return `https://wa.me/?text=${encodeURIComponent(msg)}`;
  }, [reorder, reorderCost]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} /> Analysing stock &amp; sales…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          tone="mint"
          icon={<RefreshCw size={18} />}
          value={String(reorder.length)}
          label="Items to reorder"
          sub={reorderCost > 0 ? `~${formatMoney(reorderCost)} to restock` : undefined}
        />
        <SummaryCard
          tone="peach"
          icon={<CalendarClock size={18} />}
          value={String(expiring.length)}
          label={`Expiring ≤ ${EXPIRY_WINDOW}d`}
          sub={expiringRisk > 0 ? `${formatMoney(expiringRisk)} at risk` : undefined}
        />
        <SummaryCard
          tone="rose"
          icon={<Archive size={18} />}
          value={String(dead.length)}
          label="Dead stock"
          sub={deadCapital > 0 ? `${formatMoney(deadCapital)} tied up` : undefined}
        />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <TabBtn active={tab === 'reorder'} onClick={() => setTab('reorder')} count={reorder.length}>
          <RefreshCw size={15} /> Reorder
        </TabBtn>
        <TabBtn active={tab === 'expiring'} onClick={() => setTab('expiring')} count={expiring.length}>
          <CalendarClock size={15} /> Expiring
        </TabBtn>
        <TabBtn active={tab === 'dead'} onClick={() => setTab('dead')} count={dead.length}>
          <Archive size={15} /> Dead stock
        </TabBtn>
      </div>

      {/* Reorder */}
      {tab === 'reorder' && (
        <div className="space-y-3">
          {reorder.length > 0 && orderHref && (
            <div className="breezy-card p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                Suggested order for <span className="font-semibold">{reorder.length}</span> item(s) ·
                est. <span className="font-semibold">{formatMoney(reorderCost)}</span>
              </div>
              <a
                href={orderHref}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-full bg-green-500 text-white px-4 py-2.5 text-sm font-semibold hover:bg-green-600"
              >
                <MessageCircle size={16} /> Send order on WhatsApp
              </a>
            </div>
          )}

          {reorder.length === 0 ? (
            <EmptyState
              icon={<PackageCheck size={26} className="text-mint-600" />}
              title="Stock looks healthy"
              detail="Nothing needs reordering based on your current stock and sales pace."
            />
          ) : (
            <div className="breezy-card divide-y divide-slate-50">
              {reorder.map((r) => {
                const urgent = r.p.stock_quantity === 0 || r.daysLeft <= 7;
                return (
                  <div key={r.p.id} className="flex items-center justify-between px-5 py-3.5 gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 truncate flex items-center gap-2">
                        {r.p.name}
                        {urgent && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 bg-rose-100 rounded-full px-2 py-0.5">
                            <AlertTriangle size={11} /> Urgent
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        {r.p.stock_quantity} in stock ·{' '}
                        {r.velocity > 0
                          ? `${r.velocity.toFixed(1)}/day · ${
                              isFinite(r.daysLeft) ? Math.round(r.daysLeft) : '∞'
                            }d left`
                          : 'low vs threshold'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold text-mint-600">+{r.suggestQty}</div>
                      <div className="text-xs text-slate-400">~{formatMoney(r.cost)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Expiring */}
      {tab === 'expiring' && (
        <div>
          {expiring.length === 0 ? (
            <EmptyState
              icon={<CalendarClock size={26} className="text-mint-600" />}
              title="Nothing expiring soon"
              detail={`No stock expires within ${EXPIRY_WINDOW} days.`}
            />
          ) : (
            <div className="breezy-card divide-y divide-slate-50">
              {expiring.map((e) => {
                const expired = e.dte < 0;
                return (
                  <div key={e.p.id} className="flex items-center justify-between px-5 py-3.5 gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 truncate">{e.p.name}</div>
                      <div className="text-xs text-slate-400">
                        {e.p.expiry_date} ·{' '}
                        <span className={expired ? 'text-rose-500 font-medium' : ''}>
                          {expired ? 'expired' : `${e.dte}d left`}
                        </span>{' '}
                        · {e.p.stock_quantity} in stock · {formatMoney(e.valueAtRisk)} at risk
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {expired ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 bg-rose-100 rounded-full px-2.5 py-1">
                          <RotateCcw size={12} /> Return / dispose
                        </span>
                      ) : (
                        <>
                          <div className="inline-flex items-center gap-1 text-xs font-semibold text-peach-400 bg-peach-100 rounded-full px-2.5 py-1">
                            <Tag size={12} /> {Math.round(e.discount * 100)}% off →{' '}
                            {formatMoney(e.newPrice)}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1">was {formatMoney(e.p.selling_price)}</div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Dead stock */}
      {tab === 'dead' && (
        <div>
          {dead.length === 0 ? (
            <EmptyState
              icon={<TrendingDown size={26} className="text-mint-600" />}
              title="No dead stock"
              detail={`Every in-stock product sold at least once in the last ${WINDOW_DAYS} days.`}
            />
          ) : (
            <div className="breezy-card divide-y divide-slate-50">
              {dead.map((d) => (
                <div key={d.p.id} className="flex items-center justify-between px-5 py-3.5 gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate">{d.p.name}</div>
                    <div className="text-xs text-slate-400">
                      {d.p.category ?? '—'} · {d.p.stock_quantity} in stock · no sales in{' '}
                      {WINDOW_DAYS} days
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold text-slate-700">{formatMoney(d.capital)}</div>
                    <div className="text-[11px] text-slate-400">capital tied up</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function SummaryCard({
  tone,
  icon,
  value,
  label,
  sub,
}: {
  tone: 'mint' | 'peach' | 'rose';
  icon: React.ReactNode;
  value: string;
  label: string;
  sub?: string;
}) {
  const tones = {
    mint: 'text-mint-600 bg-mint-100',
    peach: 'text-peach-400 bg-peach-100',
    rose: 'text-rose-500 bg-rose-100',
  } as const;
  return (
    <div className="breezy-card px-5 py-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${tones[tone]}`}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold leading-none text-slate-800">{value}</div>
        <div className="text-xs text-slate-400 mt-1">{label}</div>
        {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
        active ? 'bg-mint-500 text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-mint-50'
      }`}
    >
      {children}
      <span
        className={`ml-0.5 rounded-full px-1.5 text-xs ${
          active ? 'bg-white/25' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="breezy-card py-14 flex flex-col items-center text-center">
      <div className="h-14 w-14 rounded-2xl bg-mint-100 flex items-center justify-center mb-3">
        {icon}
      </div>
      <p className="font-semibold text-slate-600">{title}</p>
      <p className="text-sm text-slate-400 mt-1 max-w-sm">{detail}</p>
    </div>
  );
}
