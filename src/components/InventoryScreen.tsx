import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Plus,
  Minus,
  Search,
  AlertTriangle,
  CalendarClock,
  PackageX,
  Loader2,
  MapPin,
  PackagePlus,
  Pencil,
  X,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import type { Product } from '../types';
import { formatMoney, daysUntil } from '../lib/format';

const EXPIRY_WINDOW_DAYS = 30;

export default function InventoryScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  // null = closed, 'new' = create form, Product = edit that product
  const [formTarget, setFormTarget] = useState<Product | 'new' | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('products').select('*').order('name');
    setProducts((data as Product[]) ?? []);
    setLoading(false);
  }

  // Optimistic stock adjustment, persisted to Supabase.
  async function adjustStock(product: Product, delta: number) {
    const next = Math.max(0, product.stock_quantity + delta);
    if (next === product.stock_quantity) return;

    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, stock_quantity: next } : p)),
    );
    setSavingId(product.id);

    const { error } = await supabase
      .from('products')
      .update({ stock_quantity: next })
      .eq('id', product.id);

    if (error) {
      // Roll back on failure.
      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id ? { ...p, stock_quantity: product.stock_quantity } : p,
        ),
      );
    }
    setSavingId(null);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q) ||
        p.shelf_location?.toLowerCase().includes(q),
    );
  }, [query, products]);

  const stats = useMemo(() => {
    const low = products.filter(
      (p) => p.stock_quantity <= p.low_stock_threshold && p.stock_quantity > 0,
    ).length;
    const out = products.filter((p) => p.stock_quantity === 0).length;
    const expiring = products.filter((p) => {
      const d = daysUntil(p.expiry_date);
      return d !== null && d <= EXPIRY_WINDOW_DAYS;
    }).length;
    return { low, out, expiring };
  }, [products]);

  return (
    <div className="space-y-5">
      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-4">
        <StatChip icon={<AlertTriangle size={18} />} label="Low stock" value={stats.low} tone="amber" />
        <StatChip icon={<PackageX size={18} />} label="Out of stock" value={stats.out} tone="red" />
        <StatChip
          icon={<CalendarClock size={18} />}
          label={`Expiring ≤ ${EXPIRY_WINDOW_DAYS}d`}
          value={stats.expiring}
          tone="violet"
        />
      </div>

      {/* Search + add */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 flex-1 min-w-[240px] max-w-md focus-within:border-emerald-500">
          <Search size={18} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, category, barcode or shelf…"
            className="flex-1 outline-none text-slate-800"
          />
        </div>
        <button
          type="button"
          onClick={() => setFormTarget('new')}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 text-white px-4 py-2.5 font-medium hover:bg-emerald-700"
        >
          <PackagePlus size={18} /> New product
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 className="animate-spin mr-2" size={20} /> Loading inventory…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Shelf</th>
                  <th className="px-4 py-3 font-medium">Expiry</th>
                  <th className="px-4 py-3 font-medium text-right">Cost / Sell</th>
                  <th className="px-4 py-3 font-medium text-center">Stock</th>
                  <th className="px-4 py-3 font-medium text-center">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const isLow = p.stock_quantity <= p.low_stock_threshold;
                  const isOut = p.stock_quantity === 0;
                  const exp = daysUntil(p.expiry_date);
                  const expiringSoon = exp !== null && exp <= EXPIRY_WINDOW_DAYS;
                  const expired = exp !== null && exp < 0;

                  return (
                    <tr
                      key={p.id}
                      className={isOut ? 'bg-red-50' : isLow ? 'bg-amber-50' : 'hover:bg-slate-50'}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800 flex items-center gap-2">
                          {p.name}
                          {isLow && !isOut && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
                              <AlertTriangle size={11} /> Low
                            </span>
                          )}
                          {isOut && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-red-700 bg-red-100 rounded-full px-2 py-0.5">
                              <PackageX size={11} /> Out
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">
                          {p.category ?? '—'} · {p.barcode ?? 'no barcode'}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {p.shelf_location ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={13} className="text-slate-400" />
                            {p.shelf_location}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {p.expiry_date ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                              expired
                                ? 'bg-red-100 text-red-700'
                                : expiringSoon
                                  ? 'bg-violet-100 text-violet-700'
                                  : 'text-slate-500'
                            }`}
                          >
                            {(expired || expiringSoon) && <CalendarClock size={12} />}
                            {p.expiry_date}
                            {expiringSoon && !expired && ` · ${exp}d`}
                            {expired && ' · expired'}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right text-slate-600">
                        <div>{formatMoney(p.cost_price)}</div>
                        <div className="font-medium text-slate-800">
                          {formatMoney(p.selling_price)}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => adjustStock(p, -1)}
                            disabled={savingId === p.id || p.stock_quantity === 0}
                            className="h-8 w-8 rounded-md bg-slate-100 hover:bg-slate-200 disabled:opacity-40 flex items-center justify-center"
                          >
                            <Minus size={15} />
                          </button>
                          <span
                            className={`w-10 text-center font-semibold ${
                              isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-slate-800'
                            }`}
                          >
                            {p.stock_quantity}
                          </span>
                          <button
                            onClick={() => adjustStock(p, 1)}
                            disabled={savingId === p.id}
                            className="h-8 w-8 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-40 flex items-center justify-center"
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => setFormTarget(p)}
                            className="h-8 w-8 rounded-md bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 flex items-center justify-center"
                            title="Edit product"
                          >
                            <Pencil size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                      {products.length === 0
                        ? 'No products yet — click “New product” to add your first item.'
                        : `No products match “${query}”.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formTarget && (
        <ProductFormModal
          product={formTarget === 'new' ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={() => {
            setFormTarget(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit product modal
// ---------------------------------------------------------------------------
function ProductFormModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = product !== null;
  const [form, setForm] = useState({
    name: product?.name ?? '',
    barcode: product?.barcode ?? '',
    category: product?.category ?? '',
    batch_number: product?.batch_number ?? '',
    expiry_date: product?.expiry_date ?? '',
    shelf_location: product?.shelf_location ?? '',
    cost_price: product?.cost_price?.toString() ?? '',
    selling_price: product?.selling_price?.toString() ?? '',
    stock_quantity: product?.stock_quantity?.toString() ?? '0',
    low_stock_threshold: product?.low_stock_threshold?.toString() ?? '10',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      barcode: form.barcode.trim() || null,
      category: form.category.trim() || null,
      batch_number: form.batch_number.trim() || null,
      expiry_date: form.expiry_date || null,
      shelf_location: form.shelf_location.trim() || null,
      cost_price: Number(form.cost_price) || 0,
      selling_price: Number(form.selling_price) || 0,
      stock_quantity: parseInt(form.stock_quantity, 10) || 0,
      low_stock_threshold: parseInt(form.low_stock_threshold, 10) || 0,
    };

    const { error } = isEdit
      ? await supabase.from('products').update(payload).eq('id', product!.id)
      : await supabase.from('products').insert(payload);

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4 py-6 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl my-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">{isEdit ? 'Edit product' : 'New product'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field className="sm:col-span-2" label="Name" required>
            <input
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className={inputCls}
              placeholder="e.g. Panadol 500mg (strip)"
            />
          </Field>

          <Field label="Barcode">
            <input
              value={form.barcode}
              onChange={(e) => set('barcode', e.target.value)}
              className={inputCls}
              placeholder="Scan or type"
            />
          </Field>
          <Field label="Category">
            <input
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              className={inputCls}
              placeholder="e.g. Painkillers"
            />
          </Field>

          <Field label="Batch number">
            <input
              value={form.batch_number}
              onChange={(e) => set('batch_number', e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Shelf location">
            <input
              value={form.shelf_location}
              onChange={(e) => set('shelf_location', e.target.value)}
              className={inputCls}
              placeholder="e.g. A3"
            />
          </Field>

          <Field label="Expiry date">
            <input
              type="date"
              value={form.expiry_date}
              onChange={(e) => set('expiry_date', e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Low-stock threshold">
            <input
              type="number"
              min={0}
              value={form.low_stock_threshold}
              onChange={(e) => set('low_stock_threshold', e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label="Cost price (Rs)" required>
            <input
              type="number"
              min={0}
              step="0.01"
              required
              value={form.cost_price}
              onChange={(e) => set('cost_price', e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Selling price (Rs)" required>
            <input
              type="number"
              min={0}
              step="0.01"
              required
              value={form.selling_price}
              onChange={(e) => set('selling_price', e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label="Stock quantity" required>
            <input
              type="number"
              min={0}
              required
              value={form.stock_quantity}
              onChange={(e) => set('stock_quantity', e.target.value)}
              className={inputCls}
            />
          </Field>

          {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}

          <div className="sm:col-span-2 flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-300 py-2.5 font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.name.trim()}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 text-white py-2.5 font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="animate-spin" size={18} />}
              {isEdit ? 'Save changes' : 'Add product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none';

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="block text-sm font-medium text-slate-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function StatChip({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'amber' | 'red' | 'violet';
}) {
  const tones = {
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
  } as const;
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${tones[tone]}`}>
      <div className="opacity-80">{icon}</div>
      <div>
        <div className="text-2xl font-bold leading-none">{value}</div>
        <div className="text-xs opacity-80 mt-1">{label}</div>
      </div>
    </div>
  );
}
