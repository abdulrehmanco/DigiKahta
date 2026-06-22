import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import type { Profile, Role, Shop } from '../types';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  shop: Shop | null;
  role: Role | null;
  isOwner: boolean;
  isCashier: boolean;
  /** True only when the user has a shop AND its subscription is active. */
  shopActive: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    shopName: string,
  ) => Promise<{ error: string | null; needsConfirm: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, role, shop_id')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Failed to load profile:', error.message);
    return null;
  }
  return data as Profile;
}

async function fetchShop(shopId: string): Promise<Shop | null> {
  const { data, error } = await supabase
    .from('shops')
    .select('id, name, is_active, subscription_until, created_at')
    .eq('id', shopId)
    .single();

  if (error) {
    console.error('Failed to load shop:', error.message);
    return null;
  }
  return data as Shop;
}

function isShopActive(shop: Shop | null): boolean {
  if (!shop || !shop.is_active) return false;
  if (!shop.subscription_until) return true;
  return shop.subscription_until >= new Date().toISOString().slice(0, 10);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  // Load the profile and (if it has one) its shop.
  async function hydrate(userId: string) {
    const prof = await fetchProfile(userId);
    setProfile(prof);
    setShop(prof?.shop_id ? await fetchShop(prof.shop_id) : null);
  }

  useEffect(() => {
    let active = true;

    // Resolve the existing session on mount.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) await hydrate(data.session.user.id);
      setLoading(false);
    });

    // React to login / logout / token refresh.
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!active) return;
      setSession(newSession);
      if (newSession?.user) {
        await hydrate(newSession.user.id);
      } else {
        setProfile(null);
        setShop(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  };

  // Registers a new shop owner. The shop_name is read by the handle_new_user()
  // DB trigger, which creates the shop and links this user as its owner.
  const signUp = async (email: string, password: string, shopName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { shop_name: shopName.trim() } },
    });
    if (error) return { error: error.message, needsConfirm: false };
    // When "Confirm email" is enabled in Supabase, no session is returned until
    // the user verifies their email.
    return { error: null, needsConfirm: !data.session };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setShop(null);
    setSession(null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      shop,
      role: profile?.role ?? null,
      isOwner: profile?.role === 'owner',
      isCashier: profile?.role === 'cashier',
      shopActive: !!profile?.shop_id && isShopActive(shop),
      loading,
      signIn,
      signUp,
      signOut,
    }),
    [session, profile, shop, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
