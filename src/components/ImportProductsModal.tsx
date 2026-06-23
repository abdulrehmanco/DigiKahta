import { useRef, useState } from 'react';
import { X, Upload, FileSpreadsheet, Loader2, CheckCircle2, Download, AlertTriangle } from 'lucide-react';
import { supabase } from '../supabaseClient';

// Columns we accept, with flexible header aliases (case-insensitive).
const FIELD_ALIASES: Record<string, string[]> = {
  name: ['name', 'product', 'product name', 'title', 'item'],
  barcode: ['barcode', 'sku', 'code', 'bar code'],
  category: ['category', 'type'],
  cost_price: ['cost', 'cost price', 'cost_price', 'purchase price', 'buy price', 'buying price'],
  selling_price: ['price', 'selling price', 'selling_price', 'sale price', 'mrp', 'retail', 'sell price'],
  stock_quantity: ['stock', 'qty', 'quantity', 'stock quantity', 'stock_quantity', 'in stock'],
  low_stock_threshold: ['low stock', 'threshold', 'low_stock_threshold', 'min stock', 'reorder level', 'low stock threshold'],
  expiry_date: ['expiry', 'expiry date', 'expiry_date', 'expire', 'expires'],
  shelf_location: ['shelf', 'shelf location', 'location', 'shelf_location'],
  batch_number: ['batch', 'batch number', 'batch_number', 'lot', 'lot number'],
};

interface ParsedProduct {
  name: string;
  barcode: string | null;
  category: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  shelf_location: string | null;
  cost_price: number;
  selling_price: number;
  stock_quantity: number;
  low_stock_threshold: number;
}

// Minimal CSV parser: handles quoted fields, escaped quotes, commas, and newlines.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function mapHeaders(headers: string[]): Partial<Record<keyof ParsedProduct, number>> {
  const map: Partial<Record<keyof ParsedProduct, number>> = {};
  headers.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(key)) {
        map[field as keyof ParsedProduct] = i;
        break;
      }
    }
  });
  return map;
}

function buildProducts(rows: string[][]): { products: ParsedProduct[]; skipped: number; hasNameCol: boolean } {
  if (rows.length < 2) return { products: [], skipped: 0, hasNameCol: false };
  const cols = mapHeaders(rows[0]);
  const hasNameCol = cols.name !== undefined;
  const num = (v: string | undefined, fallback = 0) => {
    const n = parseFloat((v ?? '').replace(/[^\d.-]/g, ''));
    return isFinite(n) ? n : fallback;
  };
  const str = (v: string | undefined) => {
    const s = (v ?? '').trim();
    return s === '' ? null : s;
  };

  const products: ParsedProduct[] = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (cols.name !== undefined ? row[cols.name] : '').trim();
    if (!name) {
      skipped++;
      continue;
    }
    products.push({
      name,
      barcode: cols.barcode !== undefined ? str(row[cols.barcode]) : null,
      category: cols.category !== undefined ? str(row[cols.category]) : null,
      batch_number: cols.batch_number !== undefined ? str(row[cols.batch_number]) : null,
      expiry_date: cols.expiry_date !== undefined ? str(row[cols.expiry_date]) : null,
      shelf_location: cols.shelf_location !== undefined ? str(row[cols.shelf_location]) : null,
      cost_price: cols.cost_price !== undefined ? num(row[cols.cost_price]) : 0,
      selling_price: cols.selling_price !== undefined ? num(row[cols.selling_price]) : 0,
      stock_quantity: cols.stock_quantity !== undefined ? Math.round(num(row[cols.stock_quantity])) : 0,
      low_stock_threshold:
        cols.low_stock_threshold !== undefined ? Math.round(num(row[cols.low_stock_threshold], 10)) : 10,
    });
  }
  return { products, skipped, hasNameCol };
}

const TEMPLATE =
  'name,barcode,category,cost_price,selling_price,stock_quantity,low_stock_threshold,expiry_date,shelf_location,batch_number\n' +
  'Panadol 500mg,8964000123456,Painkillers,8,12,120,20,2027-03-31,A3,B-2291\n' +
  'Lifebuoy Soap,8901234560011,FMCG,40,55,60,10,,C1,\n';

export default function ImportProductsModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [parsed, setParsed] = useState<ParsedProduct[] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    setWarning(null);
    const text = await file.text();
    const rows = parseCSV(text);
    const { products, skipped, hasNameCol } = buildProducts(rows);
    if (!hasNameCol) {
      setError('Could not find a "name" column. Make sure the first row has column headers (e.g. name, price, stock).');
      setParsed(null);
      return;
    }
    if (products.length === 0) {
      setError('No products found in the file.');
      setParsed(null);
      return;
    }
    setParsed(products);
    if (skipped > 0) setWarning(`${skipped} row(s) skipped (missing a product name).`);
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mizan-products-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runImport() {
    if (!parsed) return;
    setImporting(true);
    setError(null);
    let inserted = 0;
    // Insert in chunks so a big catalogue doesn't hit payload limits.
    for (let i = 0; i < parsed.length; i += 200) {
      const chunk = parsed.slice(i, i + 200);
      const { error } = await supabase.from('products').insert(chunk);
      if (error) {
        setImporting(false);
        setError(
          `${error.message}. ${inserted} product(s) imported before this error — fix the file and re-import the rest.`,
        );
        if (inserted > 0) onDone();
        return;
      }
      inserted += chunk.length;
    }
    setImporting(false);
    setDone(inserted);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center px-4 py-6 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl my-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-mint-600" /> Import products from CSV
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {done !== null ? (
          <div className="py-8 flex flex-col items-center text-center">
            <div className="h-14 w-14 rounded-2xl bg-mint-100 flex items-center justify-center mb-3">
              <CheckCircle2 className="text-mint-600" size={28} />
            </div>
            <p className="font-semibold text-slate-700">Imported {done} products</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 rounded-full bg-mint-500 text-white px-6 py-2.5 font-semibold hover:bg-mint-600"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-slate-500">
                Upload a CSV with a header row. A <strong>name</strong> column is required; price,
                stock, barcode, etc. are optional.
              </p>
            </div>

            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex items-center gap-1.5 text-sm text-mint-600 font-medium hover:underline mb-4"
            >
              <Download size={15} /> Download template
            </button>

            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 hover:border-mint-300 hover:bg-mint-50/50 py-8 text-slate-500 transition"
            >
              <Upload size={24} className="text-mint-600" />
              <span className="text-sm font-medium">Choose a CSV file</span>
            </button>

            {error && (
              <p className="mt-3 flex items-start gap-2 text-sm text-rose-500 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
            {warning && !error && (
              <p className="mt-3 text-sm text-peach-400 bg-peach-100 rounded-xl px-3 py-2">{warning}</p>
            )}

            {parsed && (
              <>
                <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-2 bg-mint-50/70 text-sm font-medium text-slate-600">
                    {parsed.length} product(s) ready · preview
                  </div>
                  <div className="max-h-44 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="text-slate-400 text-left">
                        <tr>
                          <th className="px-4 py-2 font-medium">Name</th>
                          <th className="px-4 py-2 font-medium text-right">Cost</th>
                          <th className="px-4 py-2 font-medium text-right">Sell</th>
                          <th className="px-4 py-2 font-medium text-right">Stock</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {parsed.slice(0, 6).map((p, i) => (
                          <tr key={i}>
                            <td className="px-4 py-1.5 text-slate-700 truncate max-w-[180px]">{p.name}</td>
                            <td className="px-4 py-1.5 text-right text-slate-500">{p.cost_price}</td>
                            <td className="px-4 py-1.5 text-right text-slate-500">{p.selling_price}</td>
                            <td className="px-4 py-1.5 text-right text-slate-500">{p.stock_quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsed.length > 6 && (
                      <div className="px-4 py-1.5 text-[11px] text-slate-400">
                        …and {parsed.length - 6} more
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={runImport}
                  disabled={importing}
                  className="mt-4 w-full flex items-center justify-center gap-2 rounded-full bg-mint-500 text-white py-3 font-semibold hover:bg-mint-600 disabled:opacity-50"
                >
                  {importing ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
                  {importing ? 'Importing…' : `Import ${parsed.length} products`}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
