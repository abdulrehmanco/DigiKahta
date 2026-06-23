import { useState } from 'react';
import {
  LayoutDashboard,
  ScanLine,
  Boxes,
  BookUser,
  BarChart3,
  PackageCheck,
  ReceiptText,
  Users,
  LogOut,
  Menu,
  X,
  Loader2,
  Lock,
  ChevronDown,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Logo from './components/Logo';
import Login from './components/Login';
import GlobalSearch from './components/GlobalSearch';
import SyncIndicator from './components/SyncIndicator';
import Dashboard from './components/Dashboard';
import POSScreen from './components/POSScreen';
import InventoryScreen from './components/InventoryScreen';
import RestockScreen from './components/RestockScreen';
import SalesScreen from './components/SalesScreen';
import AnalyticsScreen from './components/AnalyticsScreen';
import KhataScreen from './components/KhataScreen';
import StaffScreen from './components/StaffScreen';

type ScreenId =
  | 'dashboard'
  | 'pos'
  | 'inventory'
  | 'restock'
  | 'ledger'
  | 'sales'
  | 'analytics'
  | 'staff';

interface NavItem {
  id: ScreenId;
  label: string;
  icon: React.ReactNode;
  ownerOnly?: boolean;
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { id: 'pos', label: 'POS', icon: <ScanLine size={20} /> },
  { id: 'inventory', label: 'Inventory', icon: <Boxes size={20} /> },
  { id: 'restock', label: 'Smart Stock', icon: <PackageCheck size={20} /> },
  { id: 'ledger', label: 'Ledger', icon: <BookUser size={20} /> },
  { id: 'sales', label: 'Sales', icon: <ReceiptText size={20} />, ownerOnly: true },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={20} />, ownerOnly: true },
  { id: 'staff', label: 'Staff', icon: <Users size={20} />, ownerOnly: true },
];

const TITLES: Record<ScreenId, string> = {
  dashboard: 'Dashboard',
  pos: 'POS Terminal',
  inventory: 'Inventory',
  restock: 'Smart Stock',
  ledger: 'Digital Ledger',
  sales: 'Sales History',
  analytics: 'Business Advisor',
  staff: 'Staff',
};

function Shell() {
  const { session, profile, shop, shopActive, loading, isOwner, signOut } = useAuth();
  const [screen, setScreen] = useState<ScreenId>('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true); // desktop collapse

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        <Loader2 className="animate-spin mr-2" size={22} /> Loading…
      </div>
    );
  }

  if (!session || !profile) return <Login />;

  // Signed in, but not attached to an active shop → block access (don't leak data).
  if (!shopActive) {
    return <AccountBlocked hasShop={!!profile.shop_id} shopName={shop?.name ?? null} onSignOut={signOut} />;
  }

  function go(id: ScreenId) {
    setScreen(id);
    setMobileOpen(false);
  }

  const Sidebar = (
    <aside className="flex flex-col h-full w-64 bg-gradient-to-b from-slate-950 via-slate-900 to-emerald-950 border-r border-slate-800/60">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 h-20">
        <div className="h-11 w-11 rounded-2xl overflow-hidden shadow-sm shrink-0">
          <Logo className="h-full w-full" />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-white leading-tight truncate">
            {shop?.name ?? 'Mizan Al-Raees'}
          </div>
          <div className="text-[11px] text-slate-400">POS &amp; Digital Accounts</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1.5">
        {NAV.map((item) => {
          const locked = item.ownerOnly && !isOwner;
          const activeScreen = screen === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition ${
                activeScreen
                  ? 'bg-mint-300 text-slate-900 shadow-sm'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className={activeScreen ? 'text-slate-900' : 'text-slate-400'}>{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {locked && <Lock size={14} className="text-slate-500" />}
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-slate-800">
        <button
          type="button"
          onClick={signOut}
          className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-300 hover:bg-rose-500/15 hover:text-rose-300 transition"
        >
          <LogOut size={18} /> Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="relative flex h-screen overflow-hidden bg-gradient-to-br from-mint-100 via-[#f4f8f7] to-peach-100">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-peach-200/40 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-40 h-72 w-72 rounded-full bg-mint-200/40 blur-3xl" />

      {/* Desktop sidebar (collapsible) */}
      {sidebarOpen && (
        <div className="hidden md:block flex-shrink-0 relative z-10">{Sidebar}</div>
      )}

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full shadow-xl">{Sidebar}</div>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 md:px-8 h-20 flex-shrink-0">
          {/* Mobile drawer toggle */}
          <button
            type="button"
            className="md:hidden text-slate-500"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>

          {/* Desktop sidebar collapse toggle */}
          <button
            type="button"
            className="hidden md:flex h-10 w-10 items-center justify-center rounded-full bg-white/80 backdrop-blur border border-white shadow-sm text-slate-500 hover:text-slate-700 shrink-0"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            title={sidebarOpen ? 'Hide menu' : 'Show menu'}
          >
            {sidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
          </button>

          {/* Global product / customer search */}
          <GlobalSearch onNavigate={go} />

          {/* Connectivity / offline-sync status */}
          <SyncIndicator />

          {/* Shop chip — far right */}
          <div className="relative shrink-0 ml-auto">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full bg-white/80 backdrop-blur border border-white pl-1.5 pr-3 py-1.5 shadow-sm"
            >
              <span className="h-8 w-8 rounded-full bg-mint-300 text-slate-900 flex items-center justify-center text-sm font-bold">
                {(shop?.name?.[0] ?? '?').toUpperCase()}
              </span>
              <span className="hidden sm:block text-sm font-semibold text-slate-700 max-w-[160px] truncate">
                {shop?.name ?? 'My Shop'}
              </span>
              <ChevronDown size={16} className="text-slate-400" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-60 breezy-card p-1.5 z-20">
                <div className="px-3 py-2">
                  <div className="text-sm font-semibold text-slate-800 truncate">
                    {shop?.name ?? 'My Shop'}
                  </div>
                  <div className="text-xs text-slate-400 truncate">{profile.email}</div>
                  <div className="text-[11px] uppercase tracking-wide font-semibold text-mint-600 mt-1">
                    {profile.role}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void signOut();
                  }}
                  className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-rose-50 hover:text-rose-500"
                >
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto px-4 md:px-8 pb-8">
          <h1 className="text-2xl font-bold text-slate-800 mb-5">{TITLES[screen]}</h1>
          {screen === 'dashboard' && <Dashboard />}
          {screen === 'pos' && <POSScreen />}
          {screen === 'inventory' && <InventoryScreen />}
          {screen === 'restock' && <RestockScreen />}
          {screen === 'ledger' && <KhataScreen />}
          {screen === 'sales' && <SalesScreen />}
          {screen === 'staff' && <StaffScreen />}
          {screen === 'analytics' && <AnalyticsScreen />}
        </main>
      </div>
    </div>
  );
}

function AccountBlocked({
  hasShop,
  shopName,
  onSignOut,
}: {
  hasShop: boolean;
  shopName: string | null;
  onSignOut: () => void;
}) {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden bg-gradient-to-br from-mint-100 via-[#f4f8f7] to-peach-100">
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-mint-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-peach-200/50 blur-3xl" />
      <div className="relative w-full max-w-md breezy-card shadow-lg p-8 text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-peach-100 flex items-center justify-center mb-4">
          <Lock className="text-peach-400" size={28} />
        </div>
        <h1 className="text-xl font-bold text-slate-800">
          {hasShop ? 'Subscription inactive' : 'Account not set up yet'}
        </h1>
        <p className="text-slate-500 mt-2 text-sm">
          {hasShop ? (
            <>
              {shopName ? <span className="font-medium">{shopName}</span> : 'This shop'}&rsquo;s
              subscription is paused. Please contact us to renew — your data is safe and will be
              restored the moment it&rsquo;s reactivated.
            </>
          ) : (
            <>Your login isn&rsquo;t linked to a shop yet. Please contact the administrator to finish
            setting up your account.</>
          )}
        </p>
        <button
          type="button"
          onClick={onSignOut}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-mint-500 text-white px-5 py-2.5 font-semibold hover:bg-mint-600"
        >
          <LogOut size={18} /> Sign out
        </button>
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
