import { useEffect, useState, type FormEvent } from 'react';
import { Users, UserPlus, Loader2, Lock, ShieldCheck, X, MailCheck } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { provisionCashier } from '../lib/provision';
import type { Profile } from '../types';

export default function StaffScreen() {
  const { isCashier, isOwner, profile, shop } = useAuth();
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    if (isCashier) return;
    void load();
  }, [isCashier]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, email, role, shop_id')
      .order('role', { ascending: true });
    setStaff((data as Profile[]) ?? []);
    setLoading(false);
  }

  if (isCashier) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-24">
        <div className="h-16 w-16 rounded-2xl bg-rose-100 flex items-center justify-center mb-4">
          <Lock className="text-rose-500" size={30} />
        </div>
        <h2 className="text-xl font-bold text-slate-800">Access denied</h2>
        <p className="text-slate-500 max-w-sm mt-2">Staff management is for shop owners only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          People who can sign in to <span className="font-semibold">{shop?.name ?? 'your shop'}</span>.
        </p>
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-full bg-mint-500 text-white px-5 py-3 font-semibold hover:bg-mint-600 shadow-sm active:scale-[0.98]"
          >
            <UserPlus size={18} /> Add cashier
          </button>
        )}
      </div>

      <div className="breezy-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="animate-spin mr-2" size={20} /> Loading staff…
          </div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {staff.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center font-semibold ${
                      s.role === 'owner' ? 'bg-mint-200 text-mint-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {(s.email?.[0] ?? '?').toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate">
                      {s.email}
                      {s.id === profile?.id && (
                        <span className="text-xs text-slate-400 font-normal"> (you)</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 capitalize">{s.role}</div>
                  </div>
                </div>
                {s.role === 'owner' && <ShieldCheck size={18} className="text-mint-600 shrink-0" />}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-slate-400">
        To remove someone, disable their account in Supabase → Authentication. (In-app removal is
        coming.)
      </p>

      {showAdd && profile?.shop_id && (
        <AddCashierModal
          shopId={profile.shop_id}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function AddCashierModal({
  shopId,
  onClose,
  onCreated,
}: {
  shopId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSaving(true);
    const { error, needsConfirm } = await provisionCashier(email, password, shopId);
    setSaving(false);
    if (error) {
      setError(error);
      return;
    }
    if (needsConfirm) {
      setInfo('Cashier created — they must confirm their email before signing in.');
      return;
    }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">Add cashier</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="cashier@email.com"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-mint-200 outline-none"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Temporary password (min 6)"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-mint-200 outline-none"
          />
          <p className="text-xs text-slate-400">
            Share these with your cashier — they sign in with cashier access to this shop.
          </p>
          {error && <p className="text-sm text-rose-500">{error}</p>}
          {info && (
            <p className="flex items-start gap-2 text-sm text-mint-600 bg-mint-50 border border-mint-200 rounded-xl px-3 py-2">
              <MailCheck size={16} className="mt-0.5 shrink-0" />
              {info}
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 rounded-full bg-mint-500 text-white py-2.5 font-semibold hover:bg-mint-600 disabled:opacity-50"
          >
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Users size={18} />}
            {saving ? 'Creating…' : 'Create cashier'}
          </button>
        </form>
      </div>
    </div>
  );
}
