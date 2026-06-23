-- =============================================================================
-- Mizan Al-Raees — STAFF REMOVAL
-- Run in the Supabase SQL Editor.
--
-- Owner-only: detaches a cashier from the shop (shop_id = null). They instantly
-- lose all access (RLS scopes everything to current_shop_id()). The auth login
-- still exists but can do nothing until re-added; fully delete it from the
-- Supabase dashboard if desired. SECURITY DEFINER + explicit owner check so it
-- can't be abused from the client.
-- =============================================================================
create or replace function public.remove_staff(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop   uuid := public.current_shop_id();
  v_target public.profiles;
begin
  if not public.is_owner() then
    raise exception 'Only the shop owner can remove staff';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if v_target.id is null then
    raise exception 'User not found';
  end if;
  if v_target.shop_id is distinct from v_shop then
    raise exception 'That user is not part of your shop';
  end if;
  if v_target.id = auth.uid() then
    raise exception 'You cannot remove yourself';
  end if;
  if v_target.role = 'owner' then
    raise exception 'Owners cannot be removed';
  end if;

  update public.profiles set shop_id = null where id = p_user_id;
end;
$$;
