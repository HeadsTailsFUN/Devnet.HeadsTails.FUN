import { telegramRoute } from "@/lib/earn/telegram";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => telegramRoute(req, "verification-jobs");
