// Small formatting helpers used across screens.

const currency = new Intl.NumberFormat('en-PK', {
  style: 'currency',
  currency: 'PKR',
  maximumFractionDigits: 0,
});

/** Format a number as PKR currency, e.g. 1500 → "Rs 1,500". */
export function formatMoney(value: number): string {
  return currency.format(value || 0).replace('PKR', 'Rs');
}

/** Whole-number percentage from a fraction, e.g. 0.215 → "22%". */
export function formatPercent(fraction: number): string {
  if (!isFinite(fraction)) return '0%';
  return `${Math.round(fraction * 100)}%`;
}

/** Days from today until the given ISO date (negative if already past). */
export function daysUntil(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
