/**
 * The favicon's mark, inline, so the logo in the corner of a page is the
 * same object as the one in the tab. One source of shape, two sizes.
 */
export function CarpaMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#0b0c10" />
      <path d="M 45.5 21.5 A 17 17 0 1 0 45.5 42.5" fill="none" stroke="#ffffff" strokeWidth="9" strokeLinecap="round" />
      <circle cx="46" cy="32" r="4.5" fill="#2dd4bf" />
    </svg>
  );
}
