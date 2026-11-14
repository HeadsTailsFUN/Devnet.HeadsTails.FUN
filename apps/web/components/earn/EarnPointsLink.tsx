import Link from "next/link";

export function EarnIcon({ className = "h-4 w-4" }: { className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
    <path d="M20 2v4M18 4h4" />
  </svg>;
}

export function EarnPointsLink() {
  return <Link href="/earn-points" className="earn-entry font-display">
    <EarnIcon /><span>Earn Points</span>
  </Link>;
}
