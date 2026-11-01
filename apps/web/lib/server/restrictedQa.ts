import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth/session";
import { devnetEnvironmentAllowed } from "@/lib/solana/devnetSafety";

export const QA_PLAYERS = new Set([
  "EWMAhKQsGZ7ynGBRNjPHiw36xkur6hoQ3EfhY8xvU1qt",
  "DQ3X2k93Kc1gdrVokhwbDUMRA1wwihvB9RpFcpkuzbQn",
]);

/** Uses the existing signed-challenge session, never a submitted wallet as identity. */
export async function restrictedQaAdmission(
  req: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  sessionWallet: (req: Request) => Promise<string | null> = getSessionWallet,
): Promise<NextResponse | null> {
  if (env.HEADSTAILS_RESTRICTED_QA !== "true" && env.NEXT_PUBLIC_RESTRICTED_QA !== "true") return null;
  if (env.HEADSTAILS_RESTRICTED_QA !== "true" || env.NEXT_PUBLIC_RESTRICTED_QA !== "true" ||
      !devnetEnvironmentAllowed(env)) {
    return NextResponse.json({ error: "Restricted QA unavailable" }, { status: 503 });
  }
  const wallet = await sessionWallet(req).catch(() => null);
  if (!wallet) return NextResponse.json({ error: "Verify wallet ownership for restricted QA" }, { status: 401 });
  if (!QA_PLAYERS.has(wallet)) return NextResponse.json({ error: "Restricted QA access only" }, { status: 403 });
  if (req.method === "POST") {
    const body = await req.clone().json().catch(() => null) as { wallet?: unknown } | null;
    if (body?.wallet !== undefined && body.wallet !== wallet) {
      return NextResponse.json({ error: "Connected wallet does not match verified session" }, { status: 403 });
    }
  }
  return null;
}
