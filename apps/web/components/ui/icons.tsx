export function DogIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M7 4.5 4.5 12c-1 4 1.5 10 3.5 12M25 4.5 27.5 12c1 4-1.5 10-3.5 12"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <ellipse
        cx="16"
        cy="17.5"
        rx="10.5"
        ry="9.5"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <circle cx="11.5" cy="15.5" r="1.4" fill="currentColor" />
      <circle cx="20.5" cy="15.5" r="1.4" fill="currentColor" />
      <ellipse cx="16" cy="20.5" rx="2.4" ry="1.8" fill="currentColor" />
      <path
        d="M13.8 23.5c.7 1.2 1.4 1.7 2.2 1.7s1.5-.5 2.2-1.7M12.5 22.2c-1 .3-1.8.2-2.5-.3M19.5 22.2c1 .3 1.8.2 2.5-.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CatIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 5.5 5.5 12.5M24 5.5l2.5 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M8 5.5c2 1 3.5 3 4.2 5.2M24 5.5c-2 1-3.5 3-4.2 5.2"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse
        cx="16"
        cy="18"
        rx="10.5"
        ry="9"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <circle
        cx="11.8"
        cy="16.8"
        r="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle
        cx="20.2"
        cy="16.8"
        r="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M14.5 20.5h3M16 20.5v2.2M13.8 23.2c.6.7 1.4 1 2.2 1s1.6-.3 2.2-1M8.5 18.5H5.8M8.7 20.8l-2.5.7M23.5 18.5h2.7M23.3 20.8l2.5.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SolanaIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M6.5 6.2 17.4 6.2 15.2 8.4 4.3 8.4Z" />
      <path d="M6.5 10.9h10.9l-2.2 2.2H4.3Z" opacity=".85" />
      <path d="M6.5 15.6h10.9l-2.2 2.2H4.3Z" opacity=".7" />
    </svg>
  );
}

export function WalletIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="3"
        y="6"
        width="18"
        height="13"
        rx="3"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M16 12.5h2.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M3 9.5h18" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function QueueIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="7" r="3" opacity=".95" />
      <circle cx="5.5" cy="9.5" r="2.2" opacity=".7" />
      <circle cx="18.5" cy="9.5" r="2.2" opacity=".7" />
      <path d="M5 15c0-2.6 3-4.2 7-4.2s7 1.6 7 4.2v2.5H5Z" opacity=".95" />
    </svg>
  );
}

export function LinkIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.24 4.24 0 0 0-6-6l-1.5 1.5M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.24 4.24 0 0 0 6 6L12.5 17.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LockIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="5"
        y="10"
        width="14"
        height="10"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M8 10V7.5a4 4 0 0 1 8 0V10"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="12" cy="15" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function XIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L2 3h6.4l4.4 5.9L17.8 3Zm-1.1 16.1h1.7L7.4 4.8H5.6l11.1 14.3Z" />
    </svg>
  );
}

export function DiscordIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M19.6 5.1A16.4 16.4 0 0 0 15.5 4l-.5 1a15 15 0 0 0-6 0L8.5 4a16.4 16.4 0 0 0-4.1 1.2C1.8 9.2 1.2 13 1.5 16.7A16.7 16.7 0 0 0 6.6 19.4l1.1-1.8c-.6-.2-1.2-.5-1.8-.9l.4-.3a12 12 0 0 0 10.4 0l.4.3c-.6.4-1.2.7-1.8.9l1.1 1.8a16.7 16.7 0 0 0 5.1-2.7c.4-4.3-.7-8-2.9-11.6ZM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
    </svg>
  );
}

export function TelegramIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M21.9 4.6 2.7 12.1c-.7.3-.7 1.2.1 1.4l4.8 1.5 1.8 5.6c.3.8 1.3.9 1.8.2l2.6-3.1 5 3.7c.6.4 1.4.1 1.6-.6l3.1-14.1c.2-.9-.7-1.5-1.6-1.1ZM8.4 13.4l9.5-6.6c.2-.1.4.1.2.3l-7.8 7.4-.3 3-1.6-4.1Z" />
    </svg>
  );
}

export function HeartIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 20.5C7 16.5 3 13.2 3 9.3 3 6.4 5.2 4.5 7.7 4.5c1.7 0 3.3.9 4.3 2.4 1-1.5 2.6-2.4 4.3-2.4 2.5 0 4.7 1.9 4.7 4.8 0 3.9-4 7.2-9 11.2Z" />
    </svg>
  );
}

export function InfoIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 11v5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="7.8" r="1.3" fill="currentColor" />
    </svg>
  );
}

export function GitHubIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.8-1.33-3.8-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.09 1.15A10.8 10.8 0 0 1 12 6.17c.96 0 1.92.13 2.82.38 2.14-1.45 3.08-1.15 3.08-1.15.61 1.55.23 2.69.12 2.98.72.79 1.15 1.79 1.15 3.02 0 4.32-2.63 5.27-5.14 5.55.4.35.76 1.03.76 2.08v3.1c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z" />
    </svg>
  );
}
