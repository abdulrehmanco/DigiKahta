-- =============================================================================
-- DigiKhata — Shop & Inventory Analytics PWA
-- PostgreSQL migration for Supabase. Run this in the Supabase SQL Editor.
-- =============================================================================

-- Required for gen_random_uuid()
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. PROFILES  (mirrors auth.users, holds role)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id    uuid primary key references auth.users (id) on delete cascade,
  email text,
  role  text not null default 'cashier' check (role in ('owner', 'cashier'))
);

-- -----------------------------------------------------------------------------
-- 2. PRODUCTS
-- -----------------------------------------------------------------------------
create table if not exists public.products (
  id                  uuid primary key default gen_random_uuid(),
  barcode             text unique,
  name                text not null,
  category            text,
  batch_number        text,
  expiry_date         date,
  shelf_location      text,
  cost_price          numeric(12, 2) not null default 0,
  selling_price       numeric(12, 2) not null default 0,
  stock_quantity      integer not null default 0,
  low_stock_threshold integer not null default 10
);

-- -----------------------------------------------------------------------------
-- 3. CUSTOMERS
-- -----------------------------------------------------------------------------
create table if not exists public.customers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  phone           text unique,
  current_balance numeric(12, 2) not null default 0.00
);

-- -----------------------------------------------------------------------------
-- 4. SALES RECEIPTS
-- -----------------------------------------------------------------------------
create table if not exists public.sales_receipts (
  id             uuid primary key default gen_random_uuid(),
  total_amount   numeric(12, 2) not null default 0,
  total_profit   numeric(12, 2) not null default 0,
  payment_method text not null check (payment_method in ('cash', 'card', 'khata')),
  customer_id    uuid references public.customers (id) on delete set null,
  created_at     timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 5. SALES ITEMS
-- -----------------------------------------------------------------------------
create table if not exists public.sales_items (
  id         uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.sales_receipts (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  quantity   integer not null,
  unit_price numeric(12, 2) not null,
  unit_cost  numeric(12, 2) not null
);

-- -----------------------------------------------------------------------------
-- 6. KHATA TRANSACTIONS  (ledger audit trail)
-- -----------------------------------------------------------------------------
create table if not exists public.khata_transactions (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  receipt_id  uuid references public.sales_receipts (id) on delete set null,
  type        text not null check (type in ('charge', 'payment')),
  amount      numeric(12, 2) not null,
  created_at  timestamptz not null default now()
);

-- Useful indexes for analytics / ledger lookups
create index if not exists idx_sales_receipts_created_at on public.sales_receipts (created_at);
create index if not exists idx_sales_items_receipt on public.sales_items (receipt_id);
create index if not exists idx_sales_items_product on public.sales_items (product_id);
create index if not exists idx_khata_customer on public.khata_transactions (customer_id, created_at);

-- =============================================================================
-- AUTH GLUE — auto-create a profile row whenever a user signs up
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'role', 'cashier')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used by RLS policies: is the current user an 'owner'?
create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table public.profiles           enable row level security;
alter table public.products           enable row level security;
alter table public.customers          enable row level security;
alter table public.sales_receipts     enable row level security;
alter table public.sales_items        enable row level security;
alter table public.khata_transactions enable row level security;

-- ---- profiles -------------------------------------------------------------
-- A user can always read their own profile; owners can read every profile.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_owner());

-- A user may update their own profile, but only owners may change roles
-- (enforced at the app layer; here we simply allow self-update).
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---- products -------------------------------------------------------------
-- Any signed-in staff member may read inventory.
drop policy if exists "products_select" on public.products;
create policy "products_select" on public.products
  for select to authenticated using (true);

-- Inserts / updates / deletes allowed for any authenticated staff (POS adjusts
-- stock, owners manage catalogue). Tighten to is_owner() if you want cashiers
-- read-only on the catalogue.
drop policy if exists "products_write" on public.products;
create policy "products_write" on public.products
  for all to authenticated using (true) with check (true);

-- ---- customers ------------------------------------------------------------
drop policy if exists "customers_all" on public.customers;
create policy "customers_all" on public.customers
  for all to authenticated using (true) with check (true);

-- ---- sales_receipts -------------------------------------------------------
drop policy if exists "sales_receipts_all" on public.sales_receipts;
create policy "sales_receipts_all" on public.sales_receipts
  for all to authenticated using (true) with check (true);

-- ---- sales_items ----------------------------------------------------------
drop policy if exists "sales_items_all" on public.sales_items;
create policy "sales_items_all" on public.sales_items
  for all to authenticated using (true) with check (true);

-- ---- khata_transactions ---------------------------------------------------
drop policy if exists "khata_all" on public.khata_transactions;
create policy "khata_all" on public.khata_transactions
  for all to authenticated using (true) with check (true);

-- =============================================================================
-- ATOMIC SALE RPC
-- Records a receipt + its line items, decrements stock, and (for 'khata' sales)
-- writes a ledger charge and bumps the customer's balance — all in one
-- transaction. Call from the client via supabase.rpc('process_sale', {...}).
-- =============================================================================
create or replace function public.process_sale(
  p_payment_method text,
  p_total_amount   numeric,
  p_total_profit   numeric,
  p_items          jsonb,             -- [{product_id, quantity, unit_price, unit_cost}]
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
begin
  if p_payment_method = 'khata' and p_customer_id is null then
    raise exception 'A customer is required for khata (credit) sales';
  end if;

  insert into public.sales_receipts (total_amount, total_profit, payment_method, customer_id)
  values (p_total_amount, p_total_profit, p_payment_method, p_customer_id)
  returning id into v_receipt_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.sales_items (receipt_id, product_id, quantity, unit_price, unit_cost)
    values (
      v_receipt_id,
      (v_item ->> 'product_id')::uuid,
      (v_item ->> 'quantity')::int,
      (v_item ->> 'unit_price')::numeric,
      (v_item ->> 'unit_cost')::numeric
    );

    update public.products
       set stock_quantity = stock_quantity - (v_item ->> 'quantity')::int
     where id = (v_item ->> 'product_id')::uuid;
  end loop;

  if p_payment_method = 'khata' then
    insert into public.khata_transactions (customer_id, receipt_id, type, amount)
    values (p_customer_id, v_receipt_id, 'charge', p_total_amount);

    update public.customers
       set current_balance = current_balance + p_total_amount
     where id = p_customer_id;
  end if;

  return v_receipt_id;
end;
$$;

-- =============================================================================
-- KHATA PAYMENT RPC — records a repayment and reduces the customer balance.
-- =============================================================================
create or replace function public.record_khata_payment(
  p_customer_id uuid,
  p_amount      numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.khata_transactions (customer_id, type, amount)
  values (p_customer_id, 'payment', p_amount);

  update public.customers
     set current_balance = current_balance - p_amount
   where id = p_customer_id;
end;
$$;
