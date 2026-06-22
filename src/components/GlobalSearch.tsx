import { useEffect, useRef, useState } from 'react';
import { Search, Package, User, Loader2, PackageSearch } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { formatMoney } from '../lib/format';

interface ProductHit {
  id: string;
  name: string;
  barcode: string | null;
  stock_quantity: number;
  selling_price: number;
}
interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
  current_balance: number;
}

/**
 * Global lookup in the top bar. Live-searches the current shop's products and
 * customers (RLS already scopes to the shop), shows matches, and surfaces a
 * clear "does not exist" message when nothing matches. Selecting a result
 * navigates to the relevant screen.
 */
export default function GlobalSearch({
  onNavigate,
}: {
  onNavigate: (screen: 'inventory' | 'ledger') => void;
}) {
  const [q, setQ] = useState('');
  const [products, setProducts] = useState<ProductHit[]>([]);
  const [customers, setCustomers] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Debounced live search.
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setProducts([]);
      setCustomers([]);
      setSearching(false);
      return;
    }
    // Sanitise for PostgREST's or() filter syntax (commas/parens are delimiters).
    const safe = term.replace(/[,()*%]/g, ' ').trim();
    let active = true;
    setSearching(true);
    const handle = setTimeout(async () => {
      const [{ data: p }, { data: c }] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, barcode, stock_quantity, selling_price')
          .or(`name.ilike.%${safe}%,barcode.ilike.%${safe}%`)
          .limit(6),
        supabase
          .from('customers')
          .select('id, name, phone, current_balance')
          .or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`)
          .limit(4),
      ]);
      if (!active) return;
      setProducts((p as ProductHit[]) ?? []);
      setCustomers((c as CustomerHit[]) ?? []);
      setSearching(false);
    }, 220);

    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [q]);

  const term = q.trim();
  const noResults = term !== '' && !searching && products.length === 0 && customers.length === 0;

  function pick(screen: 'inventory' | 'ledger') {
    onNavigate(screen);
    setOpen(false);
    setQ('');
  }

  return (
    <div className="relative flex-1 max-w-2xl" ref={boxRef}>
      <div className="flex items-center gap-2 rounded-full bg-white/80 backdrop-blur border border-white px-4 py-2.5 shadow-sm focus-within:ring-2 focus-within:ring-mint-200">
        <Search size={18} className="text-slate-400" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search products or customers…"
          className="flex-1 bg-transparent outline-none text-slate-700 placeholder:text-slate-400"
        />
        {searching && <Loader2 size={16} className="animate-spin text-slate-300" />}
      </div>

      {open && term !== '' && (
        <div className="absolute z-30 mt-2 w-full rounded-2xl border border-white bg-white shadow-xl overflow-hidden max-h-[70vh] overflow-y-auto">
          {products.length > 0 && (
            <div>
              <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide font-semibold text-slate-400">
                Products
              </div>
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pick('inventory')}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-mint-50 text-left"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Package size={16} className="text-mint-600 shrink-0" />
                    <span className="truncate">
                      <span className="font-medium text-slate-800">{p.name}</span>
                      <span className="text-xs text-slate-400 ml-2">{p.barcode ?? 'no barcode'}</span>
                    </span>
                  </span>
                  <span className="text-sm text-slate-500 shrink-0">
                    {formatMoney(p.selling_price)} · {p.stock_quantity} in stock
                  </span>
                </button>
              ))}
            </div>
          )}

          {customers.length > 0 && (
            <div className="border-t border-slate-50">
              <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide font-semibold text-slate-400">
                Customers
              </div>
              {customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pick('ledger')}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-mint-50 text-left"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <User size={16} className="text-peach-400 shrink-0" />
                    <span className="truncate">
                      <span className="font-medium text-slate-800">{c.name}</span>
                      <span className="text-xs text-slate-400 ml-2">{c.phone ?? '—'}</span>
                    </span>
                  </span>
                  <span className="text-sm text-slate-500 shrink-0">
                    {formatMoney(c.current_balance)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {noResults && (
            <div className="flex items-center gap-3 px-4 py-5">
              <div className="h-10 w-10 rounded-xl bg-peach-100 flex items-center justify-center shrink-0">
                <PackageSearch className="text-peach-400" size={20} />
              </div>
              <div>
                <p className="font-semibold text-slate-700 text-sm">Product does not exist</p>
                <p className="text-xs text-slate-400">
                  Nothing matches “{term}”. Check the spelling or barcode, or add it in Inventory.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
