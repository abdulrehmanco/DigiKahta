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

/** Compact relative time, e.g. "10 min ago", "2 hr ago", "3 days ago". */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
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
