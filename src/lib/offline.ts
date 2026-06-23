// Offline support for the POS: a local cache of the catalog + a queue of sales
// made while offline, flushed to Supabase on reconnect.
//
// Storage is localStorage (synchronous, dependency-free, plenty for a single
// shop's few-hundred products). For very large catalogs, IndexedDB would be the
// upgrade path — the API below hides the storage choice so that swap is easy.

import { supabase } from '../supabaseClient';
import type { Customer, PaymentMethod, Product } from '../types';

const KEY_PRODUCTS = 'alr.cache.products';
const KEY_CUSTOMERS = 'alr.cache.customers';
const KEY_QUEUE = 'alr.queue.sales';

// A sale captured locally, in the exact shape process_sale() expects.
export interface QueuedSale {
  localId: string;
  created_at: string;
  payment_method: PaymentMethod;
  total_amount: number;
  total_profit: number;
  customer_id: string | null;
  items: {
    product_id: string;
    quantity: number;
    unit_price: number;
    unit_cost: number;
  }[];
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore, app still works online */
  }
}

// ---- catalog cache --------------------------------------------------------
export const cacheProducts = (rows: Product[]) => write(KEY_PRODUCTS, rows);
export const getCachedProducts = (): Product[] => read<Product[]>(KEY_PRODUCTS, []);

export const cacheCustomers = (rows: Customer[]) => write(KEY_CUSTOMERS, rows);
export const getCachedCustomers = (): Customer[] => read<Customer[]>(KEY_CUSTOMERS, []);

// Apply an offline sale to the cached catalog so the next offline read reflects
// reduced stock and increased khata balance.
export function applySaleToCache(sale: QueuedSale) {
  const products = getCachedProducts().map((p) => {
    const line = sale.items.find((i) => i.product_id === p.id);
    return line ? { ...p, stock_quantity: p.stock_quantity - line.quantity } : p;
  });
  cacheProducts(products);

  if (sale.payment_method === 'khata' && sale.customer_id) {
    const customers = getCachedCustomers().map((c) =>
      c.id === sale.customer_id
        ? { ...c, current_balance: Number(c.current_balance) + sale.total_amount }
        : c,
    );
    cacheCustomers(customers);
  }
}

// ---- offline sales queue --------------------------------------------------
export const getQueue = (): QueuedSale[] => read<QueuedSale[]>(KEY_QUEUE, []);
export const queueCount = (): number => getQueue().length;

export function enqueueSale(sale: QueuedSale) {
  const q = getQueue();
  q.push(sale);
  write(KEY_QUEUE, q);
  applySaleToCache(sale);
}

function removeFromQueue(localId: string) {
  write(
    KEY_QUEUE,
    getQueue().filter((s) => s.localId !== localId),
  );
}

let flushing = false;

/**
 * Push every queued sale to Supabase via process_sale(). Returns how many
 * synced. Safe to call repeatedly; it no-ops if already running or empty.
 */
export async function flushQueue(): Promise<number> {
  if (flushing) return 0;
  const queue = getQueue();
  if (queue.length === 0) return 0;

  flushing = true;
  let synced = 0;
  try {
    for (const sale of queue) {
      const { error } = await supabase.rpc('process_sale', {
        p_payment_method: sale.payment_method,
        p_total_amount: sale.total_amount,
        p_total_profit: sale.total_profit,
        p_items: sale.items,
        p_customer_id: sale.customer_id,
        // The sale already happened offline — record it even if stock is now short.
        p_allow_oversell: true,
      });
      if (error) {
        // Stop on first failure (likely back offline, or a server reject);
        // keep the rest queued for the next attempt.
        break;
      }
      removeFromQueue(sale.localId);
      synced += 1;
    }
  } finally {
    flushing = false;
  }
  return synced;
}

// Unique-enough id without external deps (Date.now restriction doesn't apply
// in app code; this only runs in the browser, never in workflow scripts).
export function makeLocalId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
