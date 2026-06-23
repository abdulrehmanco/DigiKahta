// Shared domain types — mirror the PostgreSQL schema in supabase_schema.sql

export type Role = 'owner' | 'cashier';
export type PaymentMethod = 'cash' | 'card' | 'khata';
export type KhataType = 'charge' | 'payment';

export interface Profile {
  id: string;
  email: string;
  role: Role;
  shop_id: string | null;
}

export interface Shop {
  id: string;
  name: string;
  is_active: boolean;
  subscription_until: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  barcode: string | null;
  name: string;
  category: string | null;
  batch_number: string | null;
  expiry_date: string | null; // ISO date (YYYY-MM-DD)
  shelf_location: string | null;
  cost_price: number;
  selling_price: number;
  stock_quantity: number;
  low_stock_threshold: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  current_balance: number;
}

export interface SalesReceipt {
  id: string;
  total_amount: number;
  total_profit: number;
  payment_method: PaymentMethod;
  customer_id: string | null;
  created_at: string; // ISO timestamp
}

export interface SalesItem {
  id: string;
  receipt_id: string;
  product_id: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
}

export interface KhataTransaction {
  id: string;
  customer_id: string;
  receipt_id: string | null;
  type: KhataType;
  amount: number;
  created_at: string;
}

export interface Expense {
  id: string;
  amount: number;
  category: string | null;
  note: string | null;
  created_at: string;
}

// A single line in the POS cart (client-side only, before it becomes a sales_item)
export interface CartLine {
  product: Product;
  quantity: number;
}
