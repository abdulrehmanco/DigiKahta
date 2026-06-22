import { useState, type FormEvent } from 'react';
import { LogIn, UserPlus, Loader2, TreePalm, MailCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type Mode = 'signin' | 'signup';

export default function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shopName, setShopName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === 'signup';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);

    if (isSignup) {
      const { error, needsConfirm } = await signUp(email.trim(), password, shopName);
      if (error) setError(error);
      else if (needsConfirm)
        setInfo('Account created! Check your email to confirm, then sign in.');
      // If no confirmation is required, the session appears and the app loads itself.
    } else {
      const { error } = await signIn(email.trim(), password);
      if (error) setError(error);
    }
    setBusy(false);
  };

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden bg-gradient-to-br from-mint-100 via-[#f4f8f7] to-peach-100">
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-mint-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-peach-200/50 blur-3xl" />
      <div className="relative w-full max-w-sm breezy-card shadow-lg p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="h-14 w-14 rounded-2xl bg-mint-200 flex items-center justify-center mb-3 shadow-sm">
            <TreePalm className="text-mint-600" size={28} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Mizan Al-Raees</h1>
          <p className="text-sm text-slate-500">
            {isSignup ? 'Create your shop account' : 'Shop & Inventory Analytics'}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-slate-100 mb-6">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`rounded-full py-2 text-sm font-semibold transition ${
              !isSignup ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`rounded-full py-2 text-sm font-semibold transition ${
              isSignup ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
            }`}
          >
            Create shop
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignup && (
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Shop name</label>
              <input
                type="text"
                required
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-mint-200 outline-none"
                placeholder="e.g. Khan Pharmacy"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-mint-200 outline-none"
              placeholder="owner@shop.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-mint-200 outline-none"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-rose-500 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}
          {info && (
            <p className="flex items-start gap-2 text-sm text-mint-600 bg-mint-50 border border-mint-200 rounded-xl px-3 py-2">
              <MailCheck size={16} className="mt-0.5 shrink-0" />
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-full bg-mint-400 text-white font-semibold py-3 hover:bg-mint-500 disabled:opacity-60 transition shadow-sm active:scale-[0.98]"
          >
            {busy ? (
              <Loader2 className="animate-spin" size={18} />
            ) : isSignup ? (
              <UserPlus size={18} />
            ) : (
              <LogIn size={18} />
            )}
            {busy
              ? isSignup
                ? 'Creating…'
                : 'Signing in…'
              : isSignup
                ? 'Create shop account'
                : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
