import { useEffect, useState } from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useOnline } from '../hooks/useOnline';
import { flushQueue, queueCount } from '../lib/offline';

/**
 * Top-bar pill showing connectivity and offline-sale sync state. Auto-flushes
 * the queue whenever we (re)gain connectivity, and lets the user retry manually.
 */
export default function SyncIndicator() {
  const online = useOnline();
  const [pending, setPending] = useState(queueCount());
  const [syncing, setSyncing] = useState(false);

  async function sync() {
    if (!navigator.onLine || queueCount() === 0) {
      setPending(queueCount());
      return;
    }
    setSyncing(true);
    await flushQueue();
    setSyncing(false);
    setPending(queueCount());
  }

  // Re-check the queue when connectivity flips, and poll lightly so a sale
  // queued on another screen reflects here.
  useEffect(() => {
    void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  useEffect(() => {
    const id = setInterval(() => setPending(queueCount()), 2000);
    return () => clearInterval(id);
  }, []);

  if (!online) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-peach-100 text-peach-400 px-3 py-1.5 text-xs font-semibold">
        <WifiOff size={14} />
        Offline{pending > 0 ? ` · ${pending} to sync` : ''}
      </span>
    );
  }

  if (syncing || pending > 0) {
    return (
      <button
        type="button"
        onClick={sync}
        title="Sync pending sales now"
        className="flex items-center gap-1.5 rounded-full bg-mint-100 text-mint-600 px-3 py-1.5 text-xs font-semibold hover:bg-mint-200"
      >
        <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
        {syncing ? 'Syncing…' : `${pending} to sync`}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1.5 rounded-full bg-mint-100 text-mint-600 px-3 py-1.5 text-xs font-semibold">
      <Wifi size={14} />
      <CheckCircle2 size={13} />
      Online
    </span>
  );
}
