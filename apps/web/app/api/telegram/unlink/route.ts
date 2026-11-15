import { telegramRoute } from "@/lib/earn/telegram";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (req: Request) => telegramRoute(req, "unlink");
