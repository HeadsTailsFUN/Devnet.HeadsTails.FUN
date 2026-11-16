"use client";

import { useEffect } from "react";
import { storePendingReferralFromUrl } from "@/lib/referrals/client";

/** Reuse the app's validated attribution storage before a visitor explores other pages. */
export function WelcomeReferral() {
  useEffect(() => { storePendingReferralFromUrl(); }, []);
  return null;
}
