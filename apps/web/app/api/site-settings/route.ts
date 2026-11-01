import { NextResponse } from "next/server";
import { adminDb, audit, checkStaff } from "@/lib/admin/auth";
import { PUBLIC_SETTING_KEYS } from "@/lib/admin/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public site settings (allowlisted keys only; settings hold no secrets). */
export async function GET(): Promise<NextResponse> {
  const db = adminDb();
  if (!db) return NextResponse.json({ settings: {} });
  const { data } = await db.from("site_settings").select("key,value").in("key", PUBLIC_SETTING_KEYS);
  const settings: Record<string, unknown> = {};
  for (const r of (data ?? []) as Array<{ key: string; value: unknown }>) {
    settings[r.key] = r.value;
  }
  return NextResponse.json({ settings });
}
