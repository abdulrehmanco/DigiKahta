import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * Create a cashier for an existing shop WITHOUT touching the owner's session.
 * We sign the new user up on a throwaway client (persistSession: false), so the
 * owner stays logged in. The handle_new_user() DB trigger reads `shop_id` +
 * `role` from metadata and links the cashier to the owner's shop.
 *
 * Note: requires "Confirm email" to be OFF in Supabase for instant access.
 */
export async function provisionCashier(
  email: string,
  password: string,
  shopId: string,
): Promise<{ error: string | null; needsConfirm: boolean }> {
  const temp = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'alr-provision' },
  });

  const { data, error } = await temp.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { shop_id: shopId, role: 'cashier' } },
  });

  // Drop any session the temp client created; never persists anyway.
  await temp.auth.signOut().catch(() => {});

  if (error) return { error: error.message, needsConfirm: false };
  return { error: null, needsConfirm: !data.session };
}
