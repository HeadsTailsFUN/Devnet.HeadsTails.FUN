import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Earn Points — HeadsTails.fun",
  description: "Play, invite friends and complete verified quests. Explore HeadsTails Beta Points and your earning activity.",
};

export default function EarnPointsPage() {
  redirect("/?earn=1");
}
