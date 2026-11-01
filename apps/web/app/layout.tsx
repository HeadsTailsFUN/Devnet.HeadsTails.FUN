import type { Metadata, Viewport } from "next";
import "./fonts.css";
import "./globals.css";

const display = { variable: "ht-font-display" };
const body = { variable: "ht-font-body" };

export const metadata: Metadata = {
  title: "Heads or Tails — HeadsTails.fun",
  description:
    "Connect wallet, pick HEADS or TAILS, play $1/$10 simulated USD rooms using 100/1,000 test HTS, FIFO match, and an on-chain flip on Solana Devnet.",
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  // HT-QA-006: explicit icon config so /favicon.ico + /icon resolve (200).
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "Heads or Tails",
    description: "A fairer way to degen. Built on Solana.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#05070b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <head>
        <link rel="preload" href="/assets/background-panorama.webp" as="image" type="image/webp" fetchPriority="high" />
      </head>
      <body className="bg-arena min-h-[100svh] antialiased">
        {children}
      </body>
    </html>
  );
}
