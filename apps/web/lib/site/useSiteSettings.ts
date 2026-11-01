"use client";

import { useEffect, useState } from "react";

export interface SiteSettings {
  announcementText: string | null;
  heroSubtitle: string | null;
  coinHeadsUrl: string | null;
  coinTailsUrl: string | null;
  coinDefaultUrl: string | null;
  chatEnabled: boolean;
  leaderboardEnabled: boolean;
}

const DEFAULTS: SiteSettings = {
  announcementText: null,
  heroSubtitle: null,
  coinHeadsUrl: null,
  coinTailsUrl: null,
  coinDefaultUrl: null,
  chatEnabled: true,
  leaderboardEnabled: true,
};

function textOf(v: unknown): string | null {
  if (v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string") {
    const t = ((v as { text: string }).text ?? "").trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

function urlOf(v: unknown): string | null {
  if (v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string") {
    const t = ((v as { url: string }).url ?? "").trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

function boolOf(v: unknown, fallback: boolean): boolean {
  if (v && typeof v === "object" && typeof (v as { enabled?: unknown }).enabled === "boolean") {
    return (v as { enabled: boolean }).enabled;
  }
  return fallback;
}

/** Public site settings (announcement, hero, coin images, feature toggles). */
export function useSiteSettings(): SiteSettings {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULTS);

  useEffect(() => {
    let stop = false;
    fetch("/api/site-settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (stop) return;
        const s = (b as { settings?: Record<string, unknown> } | null)?.settings ?? {};
        setSettings({
          announcementText: textOf(s.announcement_text),
          heroSubtitle: textOf(s.hero_subtitle),
          coinHeadsUrl: urlOf(s.coin_heads_url),
          coinTailsUrl: urlOf(s.coin_tails_url),
          coinDefaultUrl: urlOf(s.coin_default_url),
          chatEnabled: boolOf(s.chat_enabled, true),
          leaderboardEnabled: boolOf(s.leaderboard_enabled, true),
        });
      })
      .catch(() => {
        // defaults stand
      });
    return () => {
      stop = true;
    };
  }, []);

  return settings;
}
