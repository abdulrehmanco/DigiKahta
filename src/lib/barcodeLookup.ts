// Global barcode → product lookup, used as a fallback when a scanned barcode
// is not in our own Supabase `products` table.
//
// We use the Open*Facts family (Open Food / Product / Beauty Facts): they are
// 100% free, need no API key, and send permissive CORS headers, so they work
// directly from the browser on the live Vercel site. We try them in order and
// return the first hit. (UPCitemdb's free trial is an alternative but is
// key/rate-limited and CORS-restricted, so it's less reliable from the client.)

export interface GlobalProduct {
  name: string;
  brand: string | null;
}

const ENDPOINTS = [
  'https://world.openfoodfacts.org/api/v0/product/',
  'https://world.openproductfacts.org/api/v0/product/',
  'https://world.openbeautyfacts.org/api/v0/product/',
];

export async function lookupBarcodeGlobal(barcode: string): Promise<GlobalProduct | null> {
  const code = barcode.trim();
  if (!code) return null;

  for (const base of ENDPOINTS) {
    try {
      const res = await fetch(`${base}${encodeURIComponent(code)}.json`);
      if (!res.ok) continue;
      const json = (await res.json()) as {
        status?: number;
        product?: { product_name?: string; brands?: string };
      };
      if (json.status === 1 && json.product) {
        const name = (json.product.product_name ?? '').trim();
        const brand = (json.product.brands ?? '').split(',')[0]?.trim() || null;
        if (name || brand) {
          return { name: name || (brand ?? ''), brand };
        }
      }
    } catch {
      // Network/CORS error on this source — just try the next one.
    }
  }
  return null;
}
