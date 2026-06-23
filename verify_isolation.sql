-- =============================================================================
-- ISOLATION VERIFICATION — run in the Supabase SQL Editor.
-- Confirms every tenant table has RLS on and ONLY a shop-scoped policy.
-- =============================================================================

-- A) RLS must be ENABLED on every table.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles','shops','products','customers',
                    'sales_receipts','sales_items','khata_transactions','expenses')
order by c.relname;
-- EXPECT: rls_enabled = true for ALL rows.

-- B) Every policy and its USING / WITH CHECK expression.
select tablename, policyname, cmd,
       qual        as using_expr,
       with_check  as check_expr
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles','shops','products','customers',
                    'sales_receipts','sales_items','khata_transactions','expenses')
order by tablename, policyname;
-- EXPECT: each business table (products/customers/sales_*/khata/expenses) shows
-- ONE "*_tenant" policy whose expr references current_shop_id(). profiles/shops
-- reference auth.uid()/current_shop_id(). NO expression should be just "true".

-- C) RED FLAG: any permissive "leak-all" policy still present?
select tablename, policyname, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('products','customers','sales_receipts','sales_items',
                    'khata_transactions','expenses')
  and (qual is null or qual = 'true');
-- EXPECT: ZERO rows. Any row here = a cross-shop leak (drop that policy).
