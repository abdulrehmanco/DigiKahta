// Mizan Al-Raees brand mark — a bold two-tone "M" monogram (mint-white + peach)
// on a deep emerald→teal gradient tile. Square fill; wrapper provides rounding.
export default function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="alrTile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
        <radialGradient id="alrHl" cx="0.3" cy="0.22" r="0.85">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" fill="url(#alrTile)" />
      <rect width="64" height="64" fill="url(#alrHl)" />
      <g fill="none" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 47 V20 L32 38" stroke="#ffffff" />
        <path d="M32 38 L49 20 V47" stroke="#fdba74" />
      </g>
    </svg>
  );
}
