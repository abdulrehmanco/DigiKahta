import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, type Html5QrcodeCameraScanConfig } from 'html5-qrcode';
import { X, CameraOff, Loader2 } from 'lucide-react';

const READER_ID = 'pos-barcode-reader';

const SCAN_CONFIG: Html5QrcodeCameraScanConfig = {
  fps: 10,
  // Wide-ish box suited to 1D retail barcodes (EAN/UPC) as well as QR codes.
  qrbox: { width: 280, height: 180 },
};

/**
 * Full-screen camera scanner. Calls `onDetect` with the decoded value on each
 * successful read; the parent decides what to do (look up product, add to cart).
 *
 * Lifecycle is hardened against React StrictMode's double-mount: the cleanup
 * waits for start() to finish before stopping, so the two dev-mode mounts don't
 * race two camera streams (which otherwise leaves a frozen black preview).
 */
export default function BarcodeScanner({
  onDetect,
  onClose,
}: {
  onDetect: (code: string) => void;
  onClose: () => void;
}) {
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  // Keep the latest onDetect without re-running the camera effect.
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const scanner = new Html5Qrcode(READER_ID, { verbose: false });

    const startPromise = scanner
      .start(
        { facingMode: 'environment' }, // prefer the rear camera on phones
        SCAN_CONFIG,
        (decodedText) => {
          const now = Date.now();
          // Debounce identical reads within 1.5s.
          if (decodedText === lastCodeRef.current.code && now - lastCodeRef.current.at < 1500) {
            return;
          }
          lastCodeRef.current = { code: decodedText, at: now };
          onDetectRef.current(decodedText);
        },
        () => {
          /* per-frame decode failures are normal; ignore */
        },
      )
      .then(() => setStatus('scanning'))
      .catch((err: unknown) => {
        setStatus('error');
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Could not access the camera. Check browser permissions.',
        );
      });

    return () => {
      // Wait for start() to settle, THEN tear down — prevents the StrictMode
      // double-mount from stopping a stream that hasn't finished starting.
      void startPromise.finally(() => {
        const cleanup = () => {
          try {
            scanner.clear();
          } catch {
            /* noop */
          }
        };
        try {
          // 2 === SCANNING in Html5QrcodeScannerState
          if (scanner.getState() === 2) {
            scanner.stop().then(cleanup).catch(cleanup);
          } else {
            cleanup();
          }
        } catch {
          cleanup();
        }
      });
    };
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

        <div
          className="relative rounded-xl overflow-hidden bg-slate-900"
          style={{ minHeight: 320 }}
        >
          {/* html5-qrcode injects a <video> here; force it to fill the box. */}
          <div
            id={READER_ID}
            className="w-full h-full [&_video]:!w-full [&_video]:!h-[320px] [&_video]:!object-cover"
          />

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
