"use client";

import Link from "next/link";
import { useEarnPoints } from "./EarnPointsContext";

export function EarnIcon({ className = "h-4 w-4" }: { className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
    <path d="M20 2v4M18 4h4" />
  </svg>;
}

export function EarnPointsLink({ label = "Earn Points", className = "earn-entry font-display", onOpen }: {
  label?: string; className?: string; onOpen?: () => void;
}) {
  const popup = useEarnPoints();
  const content = <><EarnIcon /><span>{label}</span></>;
  return popup ? <button type="button" className={className} aria-haspopup="dialog" aria-controls="earn-points-dialog"
    onClick={() => { onOpen?.(); popup.open(); }}>{content}</button>
    : <Link href="/?earn=1" className={className}>{content}</Link>;
}
