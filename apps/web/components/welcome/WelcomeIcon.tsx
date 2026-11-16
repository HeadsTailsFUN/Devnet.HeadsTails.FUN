import type { CSSProperties } from "react";

const paths = {
  rocket: <><path d="M14 5c3-3 7-2 7-2s1 4-2 7l-6 6-5-5 6-6Z"/><path d="m8 11-4 1-2 4 6-1m5 1-1 4-4 2 1-6M5 19l-2 2"/><circle cx="16" cy="8" r="1.5"/></>,
  play: <><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z"/></>,
  wallet: <><path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0-3 3v12a2 2 0 0 0 2 2h15V8H6a2 2 0 0 1 0-4"/><path d="M21 11h-6v5h6"/><path d="M17 13.5h.01"/></>,
  coin: <><circle cx="9" cy="12" r="7"/><path d="M15 5a7 7 0 1 1 0 14M7 10l2-2 2 2m-2-2v8"/></>,
  people: <><path d="M3 21v-3a5 5 0 0 1 10 0v3H3Zm13-8a5 5 0 0 1 5 5v3h-5M17 3a4 4 0 0 1 0 8"/><circle cx="8" cy="7" r="4"/></>,
  bolt: <path d="m14 2-10 12h7l-1 8L21 9h-8l1-7Z"/>,
  code: <><path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18"/></>,
  cube: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 0v10m9-5-9 5-9-5m9 5v10M7.5 4.5l9 5"/></>,
  link: <><path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3M14 17l-3 3a5 5 0 0 1-7-7l3-3m1 6 8-8"/></>,
  coins: <><ellipse cx="10" cy="6" rx="7" ry="3"/><path d="M3 6v5c0 4 14 4 14 0V6M3 11v5c0 4 14 4 14 0v-5M21 10v9c0 2-4 3-8 3"/></>,
  trophy: <><path d="M7 3h10v6a5 5 0 0 1-10 0V3Zm0 2H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4M12 14v6m-5 1h10"/></>,
  cross: <path d="m5 5 14 14M19 5 5 19"/>,
  invite: <><circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M20 7v8m-4-4h8"/></>,
  check: <><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9M9 10l4 4L23 3"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  flask: <><path d="M9 3h6m-5 0v6L4 19a1.5 1.5 0 0 0 1 2h14a1.5 1.5 0 0 0 1-2L14 9V3M7 15h10"/></>,
  shield: <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z"/><path d="m8 12 3 3 5-6"/></>,
} as const;
export type WelcomeIconName = keyof typeof paths;
export function WelcomeIcon({ name, className, style }: { name: WelcomeIconName; className?: string; style?: CSSProperties }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>{paths[name]}</svg>;
}
