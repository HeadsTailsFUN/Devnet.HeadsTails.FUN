"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicProfile } from "@/lib/profiles/types";

export interface ProfileState {
  profile: PublicProfile | null;
  loading: boolean;
  reload: () => void;
}

export function useProfile(wallet: string | null): ProfileState {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!wallet) {
      setProfile(null);
      return;
    }
    let stop = false;
    setLoading(true);
    fetch(`/api/profile?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!stop) setProfile((b as { profile?: PublicProfile } | null)?.profile ?? null);
      })
      .catch(() => {
        if (!stop) setProfile(null);
      })
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
    };
  }, [wallet]);

  useEffect(() => {
    const cleanup = reload();
    return cleanup;
  }, [reload]);

  return { profile, loading, reload };
}
