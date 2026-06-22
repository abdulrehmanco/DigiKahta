import { Printer, MessageCircle, X, CheckCircle2, WifiOff } from 'lucide-react';
import type { PaymentMethod } from '../types';
import { formatMoney } from '../lib/format';

export interface Receipt {
  shopName: string;
  createdAt: string;
  payment: PaymentMethod;
  total: number;
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
  customerName: string | null;
  customerPhone: string | null;
  balanceAfter: number | null; // khata balance after this sale
  offline: boolean;
}

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  khata: 'Udhaar (Credit)',
};

function buildWhatsAppText(r: Receipt): string {
  const sep = '------------------------';
  const lines = r.items
    .map((i) => `${i.name} x${i.quantity}  ${formatMoney(i.lineTotal)}`)
    .join('\n');
  let msg = `*${r.shopName}*\nReceipt — ${new Date(r.createdAt).toLocaleString()}\n${sep}\n${lines}\n${sep}\n*Total: ${formatMoney(r.total)}*\nPayment: ${PAYMENT_LABEL[r.payment]}`;
  if (r.customerName) msg += `\nCustomer: ${r.customerName}`;
  if (r.balanceAfter !== null) msg += `\nKhata balance: ${formatMoney(r.balanceAfter)}`;
  msg += `\n\nShukriya! 🙏`;
  return msg;
}

export default function ReceiptModal({
  receipt,
  onClose,
}: {
  receipt: Receipt;
  onClose: () => void;
}) {
  const phone = (receipt.customerPhone ?? '').replace(/[^\d]/g, '');
  const waHref = `https://wa.me/${phone}?text=${encodeURIComponent(buildWhatsAppText(receipt))}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center px-4 py-6 overflow-y-auto print:bg-white print:p-0">
      <div className="w-full max-w-xs my-auto print:max-w-none">
        {/* Printable receipt */}
        <div
          id="receipt-printable"
          className="bg-white rounded-2xl shadow-xl p-6 text-slate-800 font-mono text-sm"
        >
          <div className="text-center mb-3">
            <div className="text-base font-bold tracking-wide">{receipt.shopName}</div>
            <div className="text-[11px] text-slate-400">
              {new Date(receipt.createdAt).toLocaleString()}
            </div>
            {receipt.offline && (
              <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-peach-400">
                <WifiOff size={10} /> saved offline — will sync
              </div>
            )}
          </div>

          <div className="border-t border-dashed border-slate-300 my-2" />

          <div className="space-y-1">
            {receipt.items.map((i, idx) => (
              <div key={idx} className="flex justify-between gap-2">
                <span className="truncate">
                  {i.name}
                  <span className="text-slate-400"> ×{i.quantity}</span>
                </span>
                <span className="shrink-0">{formatMoney(i.lineTotal)}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-slate-300 my-2" />

          <div className="flex justify-between font-bold text-base">
            <span>Total</span>
            <span>{formatMoney(receipt.total)}</span>
          </div>
          <div className="flex justify-between text-[12px] text-slate-500 mt-0.5">
            <span>Payment</span>
            <span>{PAYMENT_LABEL[receipt.payment]}</span>
          </div>

          {receipt.customerName && (
            <div className="flex justify-between text-[12px] text-slate-500">
              <span>Customer</span>
              <span>{receipt.customerName}</span>
            </div>
          )}
          {receipt.balanceAfter !== null && (
            <div className="flex justify-between text-[12px] font-semibold text-peach-400">
              <span>Khata balance</span>
              <span>{formatMoney(receipt.balanceAfter)}</span>
            </div>
          )}

          <div className="border-t border-dashed border-slate-300 my-2" />
          <div className="text-center text-[11px] text-slate-400">Shukriya! 🙏</div>
        </div>

        {/* Actions — hidden when printing */}
        <div className="mt-4 grid grid-cols-2 gap-2 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center justify-center gap-2 rounded-full bg-slate-900 text-white py-2.5 text-sm font-semibold hover:bg-slate-800"
          >
            <Printer size={16} /> Print
          </button>
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-full bg-green-500 text-white py-2.5 text-sm font-semibold hover:bg-green-600"
          >
            <MessageCircle size={16} /> WhatsApp
          </a>
          <button
            type="button"
            onClick={onClose}
            className="col-span-2 flex items-center justify-center gap-2 rounded-full bg-mint-500 text-white py-2.5 text-sm font-semibold hover:bg-mint-600"
          >
            <CheckCircle2 size={16} /> Done — new sale
          </button>
        </div>
      </div>

      {/* Top-right close (screen only) */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white print:hidden"
        aria-label="Close receipt"
      >
        <X size={24} />
      </button>
    </div>
  );
}
