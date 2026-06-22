import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, type Html5QrcodeCameraScanConfig } from 'html5-qrcode';
import { X, CameraOff, Loader2 } from 'lucide-react';

const READER_ID = 'pos-barcode-reader';

const SCAN_CONFIG: Html5QrcodeCameraScanConfig = {
  fps: 10,
  // Wide-ish box suited to 1D retail barcodes (EAN/UPC) as well as QR codes.
  qrbox: { width: 280, height: 180 },
  aspectRatio: 1.3333,
};

/**
 * Full-screen camera scanner. Calls `onDetect` with the decoded value on each
 * successful read; the parent decides what to do (look up product, add to cart).
 * Identical reads are debounced so a barcode lingering in view isn't added many
 * times. The camera stays on for continuous scanning until the user closes it.
 */
export default function BarcodeScanner({
  onDetect,
  onClose,
}: {
  onDetect: (code: string) => void;
  onClose: () => void;
}) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const scanner = new Html5Qrcode(READER_ID, { verbose: false });
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' }, // prefer the rear camera on phones
        SCAN_CONFIG,
        (decodedText) => {
          // Debounce: ignore the same code within 1.5s.
          const now = Date.now();
          if (decodedText === lastCodeRef.current.code && now - lastCodeRef.current.at < 1500) {
            return;
          }
          lastCodeRef.current = { code: decodedText, at: now };
          onDetect(decodedText);
        },
        () => {
          /* per-frame decode failures are normal; ignore */
        },
      )
      .then(() => {
        if (!cancelled) setStatus('scanning');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Could not access the camera. Check browser permissions.',
        );
      });

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        // stop() rejects if it never started; swallow that.
        s.stop()
          .then(() => s.clear())
          .catch(() => {
            try {
              s.clear();
            } catch {
              /* noop */
            }
          });
      }
    };
    // onDetect is stable enough for our use; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800">Scan barcode</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" type="button">
            <X size={20} />
          </button>
        </div>

        <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-[4/3]">
          {/* html5-qrcode injects the <video> into this element */}
          <div id={READER_ID} className="w-full h-full [&_video]:object-cover" />

          {status === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 gap-2">
              <Loader2 className="animate-spin" size={28} />
              <span className="text-sm">Starting camera…</span>
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-slate-200 gap-2 px-6">
              <CameraOff size={30} className="text-red-400" />
              <span className="text-sm">{errorMsg}</span>
              <p className="text-xs text-slate-400">
                You can still use a USB scanner or the search box.
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400 text-center mt-3">
          Point the camera at a product barcode. Matches are added to the cart automatically.
          Camera stays on for continuous scanning.
        </p>
      </div>
    </div>
  );
}
