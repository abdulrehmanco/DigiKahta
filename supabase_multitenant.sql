-- =============================================================================
-- Mizan Al-Raees — MULTI-TENANCY MIGRATION
-- Run this in the Supabase SQL Editor AFTER the original supabase_schema.sql.
--
-- What it does:
--   • Adds a `shops` table and a `shop_id` to every business table.
--   • Isolates data per shop via RLS (a shop only ever sees its own rows).
--   • Auto-stamps shop_id on insert (so app/RPC code needs no shop wiring).
--   • Auto-provisions a shop when you invite a new owner (via user metadata).
--   • Adds an is_active / subscription_until gate per shop.
--   • WIPES existing business data (test data) for a clean start.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. SHOPS (one row per paying customer/shop)
-- -----------------------------------------------------------------------------
create table if not exists public.shops (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  is_active          boolean not null default true,
  subscription_until date,                       -- null = no expiry
  created_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. Add shop_id to every tenant-scoped table
-- -----------------------------------------------------------------------------
alter table public.profiles           add column if not exists shop_id uuid references public.shops (id) on delete set null;
alter table public.products           add column if not exists shop_id uuid references public.shops (id) on delete cascade;
alter table public.customers          add column if not exists shop_id uuid references public.shops (id) on delete cascade;
alter table public.sales_receipts     add column if not exists shop_id uuid references public.shops (id) on delete cascade;
alter table public.sales_items        add column if not exists shop_id uuid references public.shops (id) on delete cascade;
alter table public.khata_transactions add column if not exists shop_id uuid references public.shops (id) on delete cascade;

create index if not exists idx_products_shop on public.products (shop_id);
create index if not exists idx_customers_shop on public.customers (shop_id);
create index if not exists idx_receipts_shop on public.sales_receipts (shop_id);
create index if not exists idx_items_shop on public.sales_items (shop_id);
create index if not exists idx_khata_shop on public.khata_transactions (shop_id);

-- -----------------------------------------------------------------------------
-- 3. WIPE existing business data (chosen: clean start). Shops/profiles kept.
-- -----------------------------------------------------------------------------
truncate
  public.sales_items,
  public.khata_transactions,
  public.sales_receipts,
  public.customers,
  public.products
restart identity cascade;

-- -----------------------------------------------------------------------------
-- 4. Tenant helper functions (SECURITY DEFINER so they bypass profiles RLS)
-- -----------------------------------------------------------------------------
create or replace function public.current_shop_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select shop_id from public.profiles where id = auth.uid();
$$;

create or replace function public.shop_is_active()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(s.is_active, false)
         and (s.subscription_until is null or s.subscription_until >= current_date)
  from public.shops s
  where s.id = public.current_shop_id();
$$;

-- -----------------------------------------------------------------------------
-- 5. Provisioning: create/link a shop automatically on new auth user.
--    Invite flow (Supabase Dashboard → Authentication → Invite user):
--      • New OWNER  → set User Metadata: { "shop_name": "Khan Pharmacy" }
--      • New CASHIER → set User Metadata: { "shop_id": "<existing-shop-uuid>", "role": "cashier" }
--      • No metadata → a fresh shop is created named after the email.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_shop uuid;
  v_role text;
begin
  if v_meta ? 'shop_id' then
    -- Joining an existing shop (typically a cashier).
    v_shop := (v_meta ->> 'shop_id')::uuid;
    v_role := coalesce(v_meta ->> 'role', 'cashier');
  else
    -- New shop owner: spin up their shop.
    insert into public.shops (name)
    values (coalesce(nullif(v_meta ->> 'shop_name', ''), split_part(new.email, '@', 1) || '''s Shop'))
    returning id into v_shop;
    v_role := 'owner';
  end if;

  insert into public.profiles (id, email, role, shop_id)
  values (new.id, new.email, v_role, v_shop)
  on conflict (id) do update
    set shop_id = excluded.shop_id,
        role    = excluded.role,
        email   = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 6. Auto-stamp shop_id on every tenant-scoped insert, so app code that simply
--    inserts a product/customer/etc. is automatically scoped to the caller's
--    shop. Never trusts a client-supplied shop_id.
-- -----------------------------------------------------------------------------
create or replace function public.stamp_shop_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.shop_id := public.current_shop_id();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['products', 'customers', 'sales_receipts', 'sales_items', 'khata_transactions']
  loop
    execute format('drop trigger if exists stamp_shop on public.%I', t);
    execute format(
      'create trigger stamp_shop before insert on public.%I
         for each row execute function public.stamp_shop_id()', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. RLS — replace the old "using (true)" policies with per-shop isolation.
--    Reads/writes are limited to the caller's shop AND require an active sub.
-- -----------------------------------------------------------------------------
alter table public.shops enable row level security;

-- shops: a user may read their own shop (active or not, so the app can show a
-- "subscription expired" notice). No client writes — managed by you / triggers.
drop policy if exists "shops_select" on public.shops;
create policy "shops_select" on public.shops
  for select to authenticated
  using (id = public.current_shop_id());

-- profiles: read your own; owners read profiles within their shop.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (id = auth.uid() or (public.is_owner() and shop_id = public.current_shop_id()));

-- Tenant tables: identical shop-scoped + active-subscription policy.
do $$
declare t text;
begin
  foreach t in array array['products', 'customers', 'sales_receipts', 'sales_items', 'khata_transactions']
  loop
    -- drop every legacy policy name we may have created previously
    execute format('drop policy if exists "%s_select" on public.%I', t, t);
    execute format('drop policy if exists "%s_write" on public.%I', t, t);
    execute format('drop policy if exists "%s_all" on public.%I', t, t);
    execute format('drop policy if exists "%s_tenant" on public.%I', t, t);

    execute format(
      'create policy "%s_tenant" on public.%I
         for all to authenticated
         using (shop_id = public.current_shop_id() and public.shop_is_active())
         with check (shop_id = public.current_shop_id() and public.shop_is_active())',
      t, t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. RPCs — keep them SECURITY DEFINER but explicitly scope to the caller's
--    shop (definer bypasses RLS, so we guard here too) and block inactive subs.
-- -----------------------------------------------------------------------------
create or replace function public.process_sale(
  p_payment_method text,
  p_total_amount   numeric,
  p_total_profit   numeric,
  p_items          jsonb,
  p_customer_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt_id uuid;
  v_item       jsonb;
  v_shop       uuid := public.current_shop_id();
begin
  if v_shop is null or not public.shop_is_active() then
    raise exception 'Your shop account is not active.';
  end if;
  if p_payment_method = 'khata' and p_customer_id is null then
    raise exception 'A customer is required for khata (credit) sales';
  end if;

  insert into public.sales_receipts (total_amount, total_profit, payment_method, customer_id, shop_id)
  values (p_total_amount, p_total_profit, p_payment_method, p_customer_id, v_shop)
  returning id into v_receipt_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.sales_items (receipt_id, product_id, quantity, unit_price, unit_cost, shop_id)
    values (
      v_receipt_id,
      (v_item ->> 'product_id')::uuid,
      (v_item ->> 'quantity')::int,
      (v_item ->> 'unit_price')::numeric,
      (v_item ->> 'unit_cost')::numeric,
      v_shop
    );

    update public.products
       set stock_quantity = stock_quantity - (v_item ->> 'quantity')::int
     where id = (v_item ->> 'product_id')::uuid
       and shop_id = v_shop;          -- never touch another shop's stock
  end loop;

  if p_payment_method = 'khata' then
    insert into public.khata_transactions (customer_id, receipt_id, type, amount, shop_id)
    values (p_customer_id, v_receipt_id, 'charge', p_total_amount, v_shop);

    update public.customers
       set current_balance = current_balance + p_total_amount
     where id = p_customer_id
       and shop_id = v_shop;
  end if;

  return v_receipt_id;
end;
$$;

create or replace function public.record_khata_payment(p_customer_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_shop uuid := public.current_shop_id();
begin
  if v_shop is null or not public.shop_is_active() then
    raise exception 'Your shop account is not active.';
  end if;

  insert into public.khata_transactions (customer_id, type, amount, shop_id)
  values (p_customer_id, 'payment', p_amount, v_shop);

  update public.customers
     set current_balance = current_balance - p_amount
   where id = p_customer_id and shop_id = v_shop;
end;
$$;

create or replace function public.record_khata_charge(p_customer_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_shop uuid := public.current_shop_id();
begin
  if v_shop is null or not public.shop_is_active() then
    raise exception 'Your shop account is not active.';
  end if;

  insert into public.khata_transactions (customer_id, type, amount, shop_id)
  values (p_customer_id, 'charge', p_amount, v_shop);

  update public.customers
     set current_balance = current_balance + p_amount
   where id = p_customer_id and shop_id = v_shop;
end;
$$;

-- =============================================================================
-- DONE. Existing auth users now have a NULL shop_id and will be locked out
-- until re-provisioned. To attach an existing user to a new shop, run e.g.:
--
--   with s as (insert into public.shops (name) values ('My Shop') returning id)
--   update public.profiles set shop_id = (select id from s), role = 'owner'
--   where email = 'you@example.com';
--
-- New customers: Authentication → Invite user, with metadata { "shop_name": "..." }.
-- =============================================================================
