import { fileURLToPath } from "node:url";
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // HT-QA-004: intentional application-wide baseline. Minimal and safe:
  // - frame-ancestors 'none' blocks clickjacking without restricting
  //   Solana RPC / Supabase / wallets / Vercel / WebSocket / images, which a
  //   broad default-src CSP would break. Other fetch sources are intentionally
  //   unrestricted here; tightening them is a future hardening step with
  //   per-origin auditing.
  // - X-Frame-Options DENY as a legacy fallback for older browsers.
  // - nosniff + strict-origin-when-cross-origin are safe defaults.
  async headers() {
    const security = [
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];
    return [{ source: "/:path*", headers: security }];
  },
};

export default nextConfig;
