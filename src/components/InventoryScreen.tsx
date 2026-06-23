import { useEffect, useMemo, useState, lazy, Suspense, type FormEvent } from 'react';
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
  PackageSearch,
  Pencil,
  Trash2,
  X,
  Camera,
  FileSpreadsheet,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import type { Product } from '../types';
import { formatMoney, daysUntil } from '../lib/format';
import { lookupBarcodeGlobal } from '../lib/barcodeLookup';
import ImportProductsModal from './ImportProductsModal';

const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

const EXPIRY_WINDOW_DAYS = 30;

// What we hand to the form when creating a brand-new product from a scan.
interface Prefill {
  barcode: string;
  name?: string;
}

export default function InventoryScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  // null = closed, 'new' = create form, Product = edit that product
  const [formTarget, setFormTarget] = useState<Product | 'new' | null>(null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lookup, setLookup] = useState<string | null>(null); // status message during lookup
  const [detail, setDetail] = useState<'low' | 'out' | 'expiring' | null>(null);
  const [importing, setImporting] = useState(false);

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

  async function deleteProduct(product: Product) {
    const ok = window.confirm(
      `Delete "${product.name}"? This permanently removes it from your catalogue.`,
    );
    if (!ok) return;

    setSavingId(product.id);
    const { error } = await supabase.from('products').delete().eq('id', product.id);
    setSavingId(null);

    if (error) {
      // Most likely a foreign-key constraint from past sales referencing it.
      window.alert(`Could not delete: ${error.message}`);
      return;
    }
    setProducts((prev) => prev.filter((p) => p.id !== product.id));
  }

  // Camera scan → local DB → global API → open the right form.
  async function handleScanned(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;
    setScanning(false); // close the camera immediately on a successful read

    // 1. Look in OUR catalogue first (RLS scopes this to the current shop).
    setLookup(`Looking up ${code}…`);
    const { data: existing } = await supabase
      .from('products')
      .select('*')
      .eq('barcode', code)
      .maybeSingle();

    if (existing) {
      // Found locally → open it for a stock update.
      setLookup(null);
      setFormTarget(existing as Product);
      return;
    }

    // 2. Not in our DB → try the free global barcode databases.
    setLookup(`Not in your catalogue — searching global database…`);
    const global = await lookupBarcodeGlobal(code);
    setLookup(null);

    // 3. Open the "new product" form, pre-filled as far as we could.
    setPrefill({ barcode: code, name: global?.name });
    setFormTarget('new');
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

  const buckets = useMemo(() => {
    const low = products.filter(
      (p) => p.stock_quantity <= p.low_stock_threshold && p.stock_quantity > 0,
    );
    const out = products.filter((p) => p.stock_quantity === 0);
    const expiring = products.filter((p) => {
      const d = daysUntil(p.expiry_date);
      return d !== null && d <= EXPIRY_WINDOW_DAYS;
    });
    return { low, out, expiring };
  }, [products]);

  return (
    <div className="space-y-5">
      {/* Summary chips — click to see the actual items */}
      <div className="grid grid-cols-3 gap-4">
        <StatChip
          icon={<AlertTriangle size={18} />}
          label="Low stock"
          value={buckets.low.length}
          tone="amber"
          onClick={() => buckets.low.length && setDetail('low')}
        />
        <StatChip
          icon={<PackageX size={18} />}
          label="Out of stock"
          value={buckets.out.length}
          tone="red"
          onClick={() => buckets.out.length && setDetail('out')}
        />
        <StatChip
          icon={<CalendarClock size={18} />}
          label={`Expiring ≤ ${EXPIRY_WINDOW_DAYS}d`}
          value={buckets.expiring.length}
          tone="violet"
          onClick={() => buckets.expiring.length && setDetail('expiring')}
        />
      </div>

      {/* Search + add */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-full bg-white/90 backdrop-blur border border-white px-4 py-3 flex-1 min-w-[240px] max-w-md shadow-sm focus-within:ring-2 focus-within:ring-mint-200">
          <Search size={18} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, category, barcode or shelf…"
            className="flex-1 bg-transparent outline-none text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="flex items-center gap-2 rounded-full bg-white text-slate-600 border border-slate-200 px-4 py-3 font-semibold hover:bg-slate-50 shadow-sm active:scale-[0.98]"
          >
            <FileSpreadsheet size={18} /> Import CSV
          </button>
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="flex items-center gap-2 rounded-full bg-peach-300 text-white px-5 py-3 font-semibold hover:bg-peach-400 shadow-sm active:scale-[0.98]"
          >
            <Camera size={18} /> Scan barcode
          </button>
          <button
            type="button"
            onClick={() => {
              setPrefill(null);
              setFormTarget('new');
            }}
            className="flex items-center gap-2 rounded-full bg-mint-500 text-white px-5 py-3 font-semibold hover:bg-mint-600 shadow-sm active:scale-[0.98]"
          >
            <PackagePlus size={18} /> New product
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="breezy-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 className="animate-spin mr-2" size={20} /> Loading inventory…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-mint-50/70 text-slate-500 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Shelf</th>
                  <th className="px-4 py-3 font-medium">Expiry</th>
                  <th className="px-4 py-3 font-medium text-right">Cost / Sell</th>
                  <th className="px-4 py-3 font-medium text-center">Stock</th>
                  <th className="px-4 py-3 font-medium text-center">Actions</th>
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
                      className={isOut ? 'bg-rose-50/70' : isLow ? 'bg-amber-50/70' : 'hover:bg-mint-50/50'}
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
                            <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 bg-rose-100 rounded-full px-2 py-0.5">
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
                                ? 'bg-rose-100 text-rose-600'
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
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => adjustStock(p, -1)}
                            disabled={savingId === p.id || p.stock_quantity === 0}
                            className="h-8 w-8 rounded-full bg-mint-100 text-mint-600 hover:bg-mint-200 disabled:opacity-40 flex items-center justify-center"
                          >
                            <Minus size={15} />
                          </button>
                          <span
                            className={`w-10 text-center font-semibold ${
                              isOut ? 'text-rose-500' : isLow ? 'text-amber-600' : 'text-slate-800'
                            }`}
                          >
                            {p.stock_quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => adjustStock(p, 1)}
                            disabled={savingId === p.id}
                            className="h-8 w-8 rounded-full bg-peach-200 text-peach-400 hover:bg-peach-300 disabled:opacity-40 flex items-center justify-center"
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setFormTarget(p)}
                            disabled={savingId === p.id}
                            className="h-8 w-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40 flex items-center justify-center"
                            title="Edit product"
                            aria-label={`Edit ${p.name}`}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteProduct(p)}
                            disabled={savingId === p.id}
                            className="h-8 w-8 rounded-full bg-rose-50 text-rose-500 hover:bg-rose-100 disabled:opacity-40 flex items-center justify-center"
                            title="Delete product"
                            aria-label={`Delete ${p.name}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-14">
                      <div className="flex flex-col items-center text-center">
                        <div className="h-14 w-14 rounded-2xl bg-peach-100 flex items-center justify-center mb-3">
                          <PackageSearch className="text-peach-400" size={26} />
                        </div>
                        {products.length === 0 ? (
                          <>
                            <p className="font-semibold text-slate-600">No products yet</p>
                            <p className="text-sm text-slate-400 mt-1">
                              Click “New product” to add your first item.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="font-semibold text-slate-600">
                              Product does not exist
                            </p>
                            <p className="text-sm text-slate-400 mt-1">
                              Nothing matches “{query}”. Try another name, barcode or shelf —
                              or add it as a new product.
                            </p>
                            <button
                              type="button"
                              onClick={() => setFormTarget('new')}
                              className="mt-4 inline-flex items-center gap-2 rounded-full bg-mint-500 text-white px-4 py-2 text-sm font-semibold hover:bg-mint-600"
                            >
                              <PackagePlus size={16} /> Add “{query.trim()}”
                            </button>
                          </>
                        )}
                      </div>
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
          prefill={formTarget === 'new' ? prefill : null}
          onClose={() => {
            setFormTarget(null);
            setPrefill(null);
          }}
          onSaved={() => {
            setFormTarget(null);
            setPrefill(null);
            void load();
          }}
        />
      )}

      {scanning && (
        <Suspense fallback={null}>
          <BarcodeScanner onDetect={handleScanned} onClose={() => setScanning(false)} />
        </Suspense>
      )}

      {lookup && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-3 shadow-lg">
          <Loader2 className="animate-spin text-mint-300" size={18} /> {lookup}
        </div>
      )}

      {detail && (
        <StockDetailModal
          kind={detail}
          items={buckets[detail]}
          onClose={() => setDetail(null)}
          onPick={(p) => {
            setDetail(null);
            setFormTarget(p); // jump straight into editing that product
          }}
        />
      )}

      {importing && (
        <ImportProductsModal
          onClose={() => setImporting(false)}
          onDone={() => void load()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drill-down list shown when a summary chip is clicked
// ---------------------------------------------------------------------------
function StockDetailModal({
  kind,
  items,
  onClose,
  onPick,
}: {
  kind: 'low' | 'out' | 'expiring';
  items: Product[];
  onClose: () => void;
  onPick: (p: Product) => void;
}) {
  const meta = {
    low: { title: 'Low stock items', icon: <AlertTriangle size={18} />, tone: 'text-amber-600 bg-amber-100' },
    out: { title: 'Out of stock items', icon: <PackageX size={18} />, tone: 'text-rose-500 bg-rose-100' },
    expiring: {
      title: `Expiring within ${EXPIRY_WINDOW_DAYS} days`,
      icon: <CalendarClock size={18} />,
      tone: 'text-violet-600 bg-violet-100',
    },
  }[kind];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className={`h-9 w-9 rounded-xl flex items-center justify-center ${meta.tone}`}>
              {meta.icon}
            </span>
            <h3 className="font-bold text-slate-800">
              {meta.title} <span className="text-slate-400 font-medium">({items.length})</span>
            </h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <ul className="overflow-y-auto divide-y divide-slate-50">
          {items.map((p) => {
            const exp = daysUntil(p.expiry_date);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="w-full flex items-center justify-between px-5 py-3 hover:bg-mint-50/60 text-left"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate">{p.name}</div>
                    <div className="text-xs text-slate-400">
                      {p.category ?? '—'}
                      {p.shelf_location ? ` · Shelf ${p.shelf_location}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    {kind === 'expiring' ? (
                      <span className="text-sm font-semibold text-violet-600">
                        {p.expiry_date}
                        {exp !== null && (
                          <span className="block text-xs font-normal text-slate-400">
                            {exp < 0 ? 'expired' : `${exp} day${exp === 1 ? '' : 's'} left`}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span
                        className={`text-sm font-semibold ${
                          kind === 'out' ? 'text-rose-500' : 'text-amber-600'
                        }`}
                      >
                        {p.stock_quantity} left
                        <span className="block text-xs font-normal text-slate-400">
                          min {p.low_stock_threshold}
                        </span>
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400">
          Tap an item to edit it{kind === 'expiring' ? '' : ' or restock'}.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit product modal
// ---------------------------------------------------------------------------
function ProductFormModal({
  product,
  prefill,
  onClose,
  onSaved,
}: {
  product: Product | null;
  prefill?: Prefill | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = product !== null;
  const [form, setForm] = useState({
    name: product?.name ?? prefill?.name ?? '',
    barcode: product?.barcode ?? prefill?.barcode ?? '',
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
    <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center px-4 py-6 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl my-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">{isEdit ? 'Edit product' : 'New product'}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {!isEdit && prefill && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-mint-50 border border-mint-200 px-3 py-2.5 text-sm">
            <Camera size={16} className="text-mint-600 mt-0.5 shrink-0" />
            <span className="text-slate-600">
              {prefill.name
                ? 'Found online — name & barcode filled in. Review the details and add your prices/stock.'
                : 'Barcode captured. We couldn’t identify it online, so please type the product name.'}
            </span>
          </div>
        )}

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

          {error && <p className="sm:col-span-2 text-sm text-rose-500">{error}</p>}

          <div className="sm:col-span-2 flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full border border-slate-200 py-2.5 font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.name.trim()}
              className="flex-1 flex items-center justify-center gap-2 rounded-full bg-mint-500 text-white py-2.5 font-semibold hover:bg-mint-600 disabled:opacity-50 active:scale-[0.98]"
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
  'w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-mint-200 outline-none';

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
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'amber' | 'red' | 'violet';
  onClick?: () => void;
}) {
  const tones = {
    amber: 'text-amber-600 bg-amber-100',
    red: 'text-rose-500 bg-rose-100',
    violet: 'text-violet-600 bg-violet-100',
  } as const;
  const clickable = value > 0 && !!onClick;
  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={`breezy-card px-4 py-3.5 flex items-center gap-3 text-left w-full transition ${
        clickable ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : 'cursor-default'
      }`}
    >
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${tones[tone]}`}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold leading-none text-slate-800">{value}</div>
        <div className="text-xs text-slate-400 mt-1">{label}</div>
      </div>
    </button>
  );
}
