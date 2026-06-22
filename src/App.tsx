import { useState } from 'react';
import {
  ShoppingCart,
  Boxes,
  LineChart,
  BookUser,
  LogOut,
  Store,
  Menu,
  X,
  Loader2,
  Lock,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Login';
import POSScreen from './components/POSScreen';
import InventoryScreen from './components/InventoryScreen';
import AnalyticsScreen from './components/AnalyticsScreen';
import KhataScreen from './components/KhataScreen';

type ScreenId = 'pos' | 'inventory' | 'analytics' | 'khata';

interface NavItem {
  id: ScreenId;
  label: string;
  icon: React.ReactNode;
  ownerOnly?: boolean;
}

const NAV: NavItem[] = [
  { id: 'pos', label: 'POS Terminal', icon: <ShoppingCart size={20} /> },
  { id: 'inventory', label: 'Inventory', icon: <Boxes size={20} /> },
  { id: 'analytics', label: 'Analytics', icon: <LineChart size={20} />, ownerOnly: true },
  { id: 'khata', label: 'Khata Ledger', icon: <BookUser size={20} /> },
];

function Shell() {
  const { session, profile, loading, isOwner, signOut } = useAuth();
  const [screen, setScreen] = useState<ScreenId>('pos');
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={22} /> Loading…
      </div>
    );
  }

  if (!session || !profile) return <Login />;

  const active = NAV.find((n) => n.id === screen)!;

  function go(id: ScreenId) {
    setScreen(id);
    setMobileOpen(false);
  }

  const Sidebar = (
    <aside className="flex flex-col h-full w-64 bg-slate-900 text-slate-300">
      <div className="flex items-center gap-3 px-5 h-16 border-b border-slate-800">
        <div className="h-9 w-9 rounded-xl bg-emerald-600 flex items-center justify-center">
          <Store className="text-white" size={20} />
        </div>
        <div>
          <div className="font-bold text-white leading-tight">DigiKhata</div>
          <div className="text-[11px] text-slate-400">Shop Analytics</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const locked = item.ownerOnly && !isOwner;
          return (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                screen === item.id
                  ? 'bg-emerald-600 text-white'
                  : 'hover:bg-slate-800 text-slate-300'
              }`}
            >
              {item.icon}
              <span className="flex-1 text-left">{item.label}</span>
              {locked && <Lock size={14} className="text-slate-500" />}
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-slate-800">
        <div className="px-3 mb-3">
          <div className="text-sm text-white truncate">{profile.email}</div>
          <div className="text-[11px] uppercase tracking-wide text-emerald-400 font-semibold">
            {profile.role}
          </div>
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-slate-800"
        >
          <LogOut size={18} /> Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:block flex-shrink-0">{Sidebar}</div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full">{Sidebar}</div>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center gap-3 px-4 md:px-6 flex-shrink-0">
          <button
            className="md:hidden text-slate-500"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <div className="flex items-center gap-2 text-slate-800 font-semibold">
            <span className="text-emerald-600">{active.icon}</span>
            {active.label}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {screen === 'pos' && <POSScreen />}
          {screen === 'inventory' && <InventoryScreen />}
          {screen === 'analytics' && <AnalyticsScreen />}
          {screen === 'khata' && <KhataScreen />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
