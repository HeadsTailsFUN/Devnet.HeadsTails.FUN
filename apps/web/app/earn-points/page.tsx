import type { Metadata } from "next";
import { EarnPointsClient } from "@/components/earn/EarnPointsClient";
import "./earn-points.css";

export const metadata: Metadata = {
  title: "Earn Points — HeadsTails.fun",
  description: "Play, invite friends and complete verified quests. Explore HeadsTails Beta Points and your earning activity.",
};

export default function EarnPointsPage() {
  return <EarnPointsClient />;
}
