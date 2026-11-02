"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { recentMessages } from "@/lib/chat/moderation";
import { getBrowserSupabase } from "@/lib/supabase/browserClient";
import { shortWallet } from "@/lib/leaderboard";
import {
  CHAT_DISCONNECTED_COPY,
  CHAT_INPUT_PLACEHOLDER,
} from "@/lib/chat/copy";
import type { ChatMessageView } from "@/lib/chat/types";

const EMOJI = ["😀", "🎲", "🔥", "💎", "😎", "🚀", "👏", "💀"];
const POLL_FALLBACK_MS = 15000;

function timeShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function ChatPanel({
  authed,
  onNeedAuth,
  onEnsureAuth,
  hasWallet,
  onNeedWallet,
  onSelectUser,
}: {
  authed: boolean;
  /** @deprecated Use onEnsureAuth. Kept for backward-compat; never opens Profile. */
  onNeedAuth?: () => void;
  /** Inline wallet-ownership verification. Must return true when session is ready. */
  onEnsureAuth?: () => Promise<boolean>;
  /** True when a wallet is connected (even if chat session is unauthenticated). */
  hasWallet?: boolean;
  /** Called when Send needs a wallet connection (never opens Profile). */
  onNeedWallet?: () => void;
  onSelectUser?: (wallet: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessageView[] | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const requestIdRef = useRef(0);
  const sendIdentityRef = useRef<{ body: string; id: string } | null>(null);
  const scrollAnchor = useRef<{
    bottom: boolean;
    id?: string;
    offset?: number;
  } | null>(null);
  useEffect(() => {
    const tick = () =>
      setRemaining(Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)));
    tick();
    if (cooldownUntil <= Date.now()) return;
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [cooldownUntil]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [authing, setAuthing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [loadState, setLoadState] = useState<
    "connecting" | "ready" | "unavailable"
  >("connecting");
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const sendingRef = useRef(false);
  const pendingSendRef = useRef(false);
  const channelRef = useRef<{ unsubscribe: () => void } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const slowRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // HT-QA-001: stable loader identity. The loader must NOT close over
  // `messages` (which it itself sets), otherwise messages changes →
  // loader identity changes → effect reruns → subscription recreated →
  // load reruns → request storm (116 GET / 65s observed). Track the
  // null-vs-loaded distinction in a ref instead.
  const messagesNullRef = useRef(true);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch("/api/chat/messages?limit=100", {
        cache: "no-store",
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!r.ok) {
        setLoadState((prev) =>
          messagesNullRef.current && prev === "connecting"
            ? "unavailable"
            : prev,
        );
        return;
      }
      const b = (await r.json().catch(() => null)) as {
        messages?: ChatMessageView[];
      } | null;
      if (b && Array.isArray(b.messages)) {
        messagesNullRef.current = false;
        // Functional update avoids re-reading state and keeps identity stable.
        if (requestId !== requestIdRef.current) return;
        const el = listRef.current;
        const anchor = el
          ? Array.from(
              el.querySelectorAll<HTMLElement>("[data-message-id]"),
            ).find(
              (node) =>
                node.getBoundingClientRect().bottom >
                el.getBoundingClientRect().top,
            )
          : undefined;
        scrollAnchor.current = {
          bottom: !el || el.scrollHeight - el.scrollTop - el.clientHeight < 100,
          id: anchor?.dataset.messageId,
          offset:
            anchor && el
              ? anchor.getBoundingClientRect().top -
                el.getBoundingClientRect().top
              : 0,
        };
        setMessages(recentMessages(b.messages as ChatMessageView[]));
        setLive(true);
        setLoadState("ready");
      } else if (messagesNullRef.current) {
        setLoadState("unavailable");
      }
    } catch {
      setLoadState((prev) =>
        messagesNullRef.current && prev === "connecting" ? "unavailable" : prev,
      );
    }
  }, []);

  const subscribe = useCallback(() => {
    // Singleton discipline: never create a second channel or second poll
    // timer while one exists. Resume paths call subscribe() after cleanup.
    if (channelRef.current || pollRef.current) return;
    try {
      const db = getBrowserSupabase();
      if (db) {
        const ch = db
          .channel("global-chat")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "chat_messages" },
            () => {
              void load();
            },
          )
          .subscribe((status) => {
            if (
              status === "CHANNEL_ERROR" ||
              status === "TIMED_OUT" ||
              status === "CLOSED"
            ) {
              if (!pollRef.current) {
                pollRef.current = setInterval(() => {
                  void load();
                }, POLL_FALLBACK_MS);
              }
            }
          });
        channelRef.current = { unsubscribe: () => void ch.unsubscribe() };
        return;
      }
    } catch {
      // fall through to polling
    }
    if (!pollRef.current) {
      pollRef.current = setInterval(() => {
        void load();
      }, POLL_FALLBACK_MS);
    }
  }, [load]);

  const cleanupSubscription = useCallback(() => {
    try {
      channelRef.current?.unsubscribe();
    } catch {
      // ignore
    }
    channelRef.current = null;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => {
    void load();
    subscribe();
    // Safety net: always poll at a slow cadence even with realtime.
    if (!slowRef.current) {
      slowRef.current = setInterval(() => {
        void load();
      }, 60000);
    }
    const onVisible = () => {
      if (!document.hidden) {
        // Mobile background → foreground: reload recent chat, restore
        // subscription if needed, preserve draft, no duplicate channels.
        cleanupSubscription();
        void load();
        subscribe();
      }
    };
    const onOnline = () => {
      cleanupSubscription();
      void load();
      subscribe();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      cleanupSubscription();
      if (slowRef.current) clearInterval(slowRef.current);
      slowRef.current = null;
    };
  }, [load, subscribe, cleanupSubscription]);

  useLayoutEffect(() => {
    const el = listRef.current,
      anchor = scrollAnchor.current;
    if (!el || !anchor) return;
    if (anchor.bottom) el.scrollTop = el.scrollHeight;
    else {
      const row = Array.from(
        el.querySelectorAll<HTMLElement>("[data-message-id]"),
      ).find((node) => node.dataset.messageId === anchor.id);
      if (row)
        el.scrollTop +=
          row.getBoundingClientRect().top -
          el.getBoundingClientRect().top -
          (anchor.offset ?? 0);
    }
  }, [messages]);

  const send = useCallback(async () => {
    if (sendingRef.current || Date.now() < cooldownUntil) return;
    const text = draft.trim();
    if (!text) return;
    // P0: Send is ALWAYS a chat action — it must never open Profile and must
    // never close mobile chat. Unauthenticated flow is inline:
    // preserve draft -> verify wallet ownership -> continue ORIGINAL send.
    if (!authed) {
      const walletConnected = hasWallet ?? true;
      if (!walletConnected) {
        // Wallet NOT connected: preserve draft, open wallet connect or show
        // the compact chat note. Never Profile.
        pendingSendRef.current = true;
        if (onNeedWallet) {
          onNeedWallet();
          return;
        }
        setNote("Connect wallet to chat");
        return;
      }
      if (onEnsureAuth) {
        sendingRef.current = true;
        setAuthing(true);
        setNote(null);
        try {
          const ok = await onEnsureAuth();
          if (!ok) {
            // Rejected signature / failed verification: preserve draft, no
            // duplicate, no loop. User retries with a single click.
            pendingSendRef.current = true;
            return;
          }
        } catch {
          pendingSendRef.current = true;
          setNote("Wallet verification failed. Try again.");
          return;
        } finally {
          sendingRef.current = false;
          setAuthing(false);
        }
        // Auth succeeded: fall through to the ORIGINAL send exactly once.
      } else {
        // Legacy fallback: preserve draft and surface the compact note.
        // Never open Profile from Send.
        if (draft.trim()) pendingSendRef.current = true;
        onNeedAuth?.();
        return;
      }
    }
    const body = draft.trim().slice(0, 280);
    if (!body) return;
    sendingRef.current = true;
    setSending(true);
    setNote(null);
    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body,
          clientId: (sendIdentityRef.current?.body === body
            ? sendIdentityRef.current
            : (sendIdentityRef.current = { body, id: crypto.randomUUID() })
          ).id,
        }),
      });
      const b = (await res.json().catch(() => null)) as {
        error?: string;
        retryAfterMs?: number;
        cooldownMs?: number;
      } | null;
      if (!res.ok) {
        // 401 here means the session did not stick: keep draft for retry.
        if (res.status === 401) pendingSendRef.current = true;
        if (res.status === 429)
          setCooldownUntil(
            Date.now() + Math.min(60000, Math.max(1, b?.retryAfterMs ?? 3000)),
          );
        setNote(b?.error ?? "Could not send.");
        return;
      }
      pendingSendRef.current = false;
      setDraft("");
      sendIdentityRef.current = null;
      if (b?.cooldownMs) setCooldownUntil(Date.now() + b.cooldownMs);
      await load();
    } catch {
      setNote("Connection interrupted. Retry safely; your draft is kept.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [
    authed,
    draft,
    load,
    hasWallet,
    onEnsureAuth,
    onNeedWallet,
    onNeedAuth,
    cooldownUntil,
  ]);

  // After external auth completes (e.g. session refresh), automatically
  // continue the preserved send once. Draft stays intact until success.
  useEffect(() => {
    if (
      authed &&
      pendingSendRef.current &&
      draft.trim() &&
      !sendingRef.current
    ) {
      pendingSendRef.current = false;
      void send();
    }
    if (authed && !draft.trim()) {
      pendingSendRef.current = false;
    }
  }, [authed, draft, send]);

  return (
    <section
      aria-label="Global chat"
      className="glass flex h-full min-h-[560px] w-full min-w-0 flex-1 flex-col rounded-3xl p-4"
    >
      <div className="flex items-center gap-2">
        <h2 className="font-display text-[16px] font-bold text-white">
          Global Chat
        </h2>
        <span
          title={live ? "Live updates" : "Connecting…"}
          className={`h-2 w-2 rounded-full ${live ? "bg-[var(--heads)]" : "bg-white/20"}`}
          aria-hidden="true"
        />
      </div>
      <div
        ref={listRef}
        aria-live="polite"
        className="mt-2 flex max-h-[52svh] min-h-[280px] flex-1 flex-col gap-2 overflow-y-auto pr-1 xl:max-h-none xl:min-h-0"
      >
        {messages === null ? (
          loadState === "unavailable" ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <p className="text-center text-[13px] text-[var(--text-secondary)]">
                Chat unavailable
              </p>
              <button
                type="button"
                onClick={() => {
                  setLoadState("connecting");
                  void load();
                }}
                className="inline-flex min-h-[44px] items-center rounded-2xl border border-white/15 px-5 text-[13px] font-bold text-white transition hover:bg-white/10"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-6">
              <p className="text-center text-[13px] text-[var(--text-secondary)]">
                Connecting...
              </p>
              <button
                type="button"
                onClick={() => {
                  void load();
                }}
                className="inline-flex min-h-[44px] items-center rounded-2xl border border-white/15 px-5 text-[13px] font-bold text-white transition hover:bg-white/10"
              >
                Retry
              </button>
            </div>
          )
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[var(--text-secondary)]">
            No messages yet. Say hi.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              data-message-id={m.id}
              className="flex items-start gap-2"
            >
              {m.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.avatarUrl}
                  alt=""
                  width={24}
                  height={24}
                  className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white"
                >
                  {(m.username ?? m.wallet).slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-1.5">
                  <button
                    type="button"
                    onClick={() => onSelectUser?.(m.wallet)}
                    className={`truncate text-[12.5px] font-bold hover:underline ${m.rankColorClass}`}
                  >
                    {m.username ?? shortWallet(m.wallet)}
                  </button>
                  <span className="rounded-full border border-white/10 px-1 text-[9px] font-bold tracking-widest text-white/50">
                    {m.displayRank}
                  </span>
                  <span className="text-[10px] text-white/30">
                    {timeShort(m.createdAt)}
                  </span>
                </p>
                <p className="break-words text-[13.5px] leading-snug text-white/90">
                  {m.body}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      <div
        className="mt-2 flex gap-1.5 overflow-x-auto pb-1"
        aria-label="Emoji picker"
      >
        {EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            aria-label={`Insert ${e}`}
            onClick={() => {
              setDraft((d) => (d + e).slice(0, 280));
              inputRef.current?.focus();
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/5 text-[16px] transition hover:bg-white/10"
          >
            {e}
          </button>
        ))}
      </div>
      {!authed && (
        <p className="mt-2 text-center text-[13px] font-semibold text-white/70">
          {CHAT_DISCONNECTED_COPY}
        </p>
      )}
      <div className="mt-1 flex gap-2">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 280))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={280}
          placeholder={CHAT_INPUT_PLACEHOLDER}
          aria-label="Chat message"
          className="max-h-24 min-h-[44px] min-w-0 flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-base text-white placeholder:text-white/30"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || authing || remaining > 0}
          className="font-display inline-flex min-h-[44px] shrink-0 items-center rounded-2xl bg-white px-5 text-[14px] font-bold text-black transition hover:bg-slate-200 disabled:opacity-60"
        >
          {remaining > 0
            ? `${remaining}s`
            : sending
              ? "…"
              : authing
                ? "Verifying…"
                : "Send"}
        </button>
      </div>
      {remaining > 0 && (
        <p role="status" className="mt-1 text-xs text-white/60">
          Ready again in {remaining}s.
        </p>
      )}
      {note && (
        <p role="alert" className="mt-1 text-[12px] font-medium text-[#ff9db1]">
          {note}
        </p>
      )}
    </section>
  );
}
