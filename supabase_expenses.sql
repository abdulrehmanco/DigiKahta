-- =============================================================================
-- Mizan Al-Raees — EXPENSES
-- Run in the Supabase SQL Editor AFTER supabase_multitenant.sql.
--
-- Shop expenses (rent, utilities, salaries, supplies, etc.) — kept entirely
-- separate from the customer khata (which tracks what customers owe the shop).
-- Reuses the existing multi-tenant helpers (stamp_shop_id, current_shop_id,
-- shop_is_active), so it is shop-isolated like every other table.
-- =============================================================================

create table if not exists public.expenses (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid references public.shops (id) on delete cascade,
  amount     numeric(12, 2) not null,
  category   text,            -- e.g. rent, utilities, salaries, supplies, other
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_expenses_shop on public.expenses (shop_id, created_at);

-- Auto-stamp shop_id on insert (never trust a client-supplied value).
drop trigger if exists stamp_shop on public.expenses;
create trigger stamp_shop before insert on public.expenses
  for each row execute function public.stamp_shop_id();

-- Per-shop isolation + active-subscription gate, identical to other tables.
alter table public.expenses enable row level security;

drop policy if exists "expenses_tenant" on public.expenses;
create policy "expenses_tenant" on public.expenses
  for all to authenticated
  using (shop_id = public.current_shop_id() and public.shop_is_active())
  with check (shop_id = public.current_shop_id() and public.shop_is_active());
