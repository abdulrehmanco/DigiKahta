-- =============================================================================
-- Mizan Al-Raees — SALES SAFETY: oversell guard + returns/void
-- Run in the Supabase SQL Editor AFTER the other migrations.
-- =============================================================================

-- 1. Never allow negative stock at the DB level.
update public.products set stock_quantity = 0 where stock_quantity < 0;
alter table public.products drop constraint if exists products_stock_nonneg;
alter table public.products add constraint products_stock_nonneg check (stock_quantity >= 0);

-- 2. process_sale — blocks overselling online; clamps stock; lets offline
--    replays through (the sale already happened, so record it and floor at 0).
create or replace function public.process_sale(
  p_payment_method text,
  p_total_amount   numeric,
  p_total_profit   numeric,
  p_items          jsonb,
  p_customer_id    uuid default null,
  p_allow_oversell boolean default false
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
  v_stock      int;
  v_name       text;
  v_qty        int;
begin
  if v_shop is null or not public.shop_is_active() then
    raise exception 'Your shop account is not active.';
  end if;
  if p_payment_method = 'khata' and p_customer_id is null then
    raise exception 'A customer is required for khata (credit) sales';
  end if;

  -- Stock sufficiency check (skipped for offline replays).
  if not p_allow_oversell then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_qty := (v_item ->> 'quantity')::int;
      select stock_quantity, name into v_stock, v_name
        from public.products
       where id = (v_item ->> 'product_id')::uuid and shop_id = v_shop;
      if v_stock is null then
        raise exception 'Product not found in your shop';
      end if;
      if v_stock < v_qty then
        raise exception 'Not enough stock for %: have %, need %', v_name, v_stock, v_qty;
      end if;
    end loop;
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
       set stock_quantity = greatest(0, stock_quantity - (v_item ->> 'quantity')::int)
     where id = (v_item ->> 'product_id')::uuid and shop_id = v_shop;
  end loop;

  if p_payment_method = 'khata' then
    insert into public.khata_transactions (customer_id, receipt_id, type, amount, shop_id)
    values (p_customer_id, v_receipt_id, 'charge', p_total_amount, v_shop);
    update public.customers
       set current_balance = current_balance + p_total_amount
     where id = p_customer_id and shop_id = v_shop;
  end if;

  return v_receipt_id;
end;
$$;

-- 3. process_return — void a sale: restock items, reverse any khata, delete it.
create or replace function public.process_return(p_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop    uuid := public.current_shop_id();
  v_receipt public.sales_receipts;
  v_item    public.sales_items;
begin
  if v_shop is null or not public.shop_is_active() then
    raise exception 'Your shop account is not active.';
  end if;

  select * into v_receipt
    from public.sales_receipts
   where id = p_receipt_id and shop_id = v_shop;
  if v_receipt.id is null then
    raise exception 'Sale not found';
  end if;

  -- Put the stock back.
  for v_item in select * from public.sales_items
                 where receipt_id = p_receipt_id and shop_id = v_shop
  loop
    update public.products
       set stock_quantity = stock_quantity + v_item.quantity
     where id = v_item.product_id and shop_id = v_shop;
  end loop;

  -- Reverse the khata if it was a credit sale.
  if v_receipt.payment_method = 'khata' and v_receipt.customer_id is not null then
    update public.customers
       set current_balance = current_balance - v_receipt.total_amount
     where id = v_receipt.customer_id and shop_id = v_shop;
    delete from public.khata_transactions
     where receipt_id = p_receipt_id and shop_id = v_shop;
  end if;

  -- Delete the sale (sales_items cascade via FK).
  delete from public.sales_receipts where id = p_receipt_id and shop_id = v_shop;
end;
$$;
