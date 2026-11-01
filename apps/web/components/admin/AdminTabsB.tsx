"use client";

import { useCallback, useEffect, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { shortWallet } from "@/lib/leaderboard";

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; body: unknown }> {
  try {
    const r = await fetch(path, init);
    return { ok: r.ok, body: await r.json().catch(() => null) };
  } catch {
    return { ok: false, body: null };
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-3xl p-4">
      <h3 className="font-display text-[15px] font-bold text-white">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function ChatTab() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ body: chat }, { body: settings }] = await Promise.all([
      api("/api/admin/chat"),
      api("/api/admin/settings"),
    ]);
    const msgs = (chat as { messages?: Array<Record<string, unknown>> } | null)?.messages ?? [];
    setRows(msgs);
    const list = ((settings as { settings?: Array<{ key: string; value: unknown }> })?.settings ?? []);
    const ce = list.find((s) => s.key === "chat_enabled") as { value?: { enabled?: boolean } } | undefined;
    setEnabled(ce?.value?.enabled ?? true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (id: string, restore: boolean) => {
    setNote(null);
    const { ok } = await api("/api/admin/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, restore }),
    });
    if (!ok) setNote("Moderation failed.");
    await load();
  };

  const toggleSending = async () => {
    if (enabled === null) return;
    const { ok } = await api("/api/admin/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "chat_enabled", value: !enabled }),
    });
    if (!ok) setNote("Toggle failed.");
    await load();
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Chat sending">
        <div className="flex items-center gap-3">
          <p className="text-[13px] text-white">Currently: {enabled === null ? "…" : enabled ? "enabled" : "DISABLED"}</p>
          <button type="button" onClick={() => void toggleSending()} className="rounded-2xl bg-white px-4 py-2 text-[12px] font-bold text-black">
            {enabled ? "Disable" : "Enable"}
          </button>
        </div>
        {note && <p role="alert" className="mt-2 text-[12px] text-[#ff9db1]">{note}</p>}
      </Section>
      <Section title="Live chat">
        <ul className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto">
          {rows.map((m) => (
            <li key={String(m.id)} className={`rounded-xl px-3 py-2 text-[12px] ${m.deleted_at ? "bg-red-500/10 opacity-60" : "bg-white/5"}`}>
              <p className="font-bold text-white">
                {shortWallet(String(m.wallet ?? ""))} <span className="font-medium text-white/40">{String(m.created_at ?? "").slice(11, 16)}</span>
              </p>
              <p className="break-words text-white/85">{String(m.body ?? "")}</p>
              <button
                type="button"
                onClick={() => void toggle(String(m.id), Boolean(m.deleted_at))}
                className="mt-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-bold text-white hover:bg-white/15"
              >
                {m.deleted_at ? "Restore" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/** HT-FINAL-004 + HT-OBS: terminal game-load states (never infinite Loading). */
export type AdminGameTabLoad =
  | { status: "loading" }
  | { status: "success"; game: Record<string, string | boolean> }
  | { status: "error"; diagnostic: string | null };

export function GameTab({
  address,
  signAndSendAdmin,
}: {
  address: string | null;
  signAndSendAdmin: (tx: Transaction) => Promise<string>;
}) {
  const [loadState, setLoadState] = useState<AdminGameTabLoad>({ status: "loading" });
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    const { ok, body } = await api("/api/admin/game");
    if (
      ok &&
      body &&
      typeof body === "object" &&
      typeof (body as { paused?: unknown }).paused === "boolean"
    ) {
      setLoadState({ status: "success", game: body as Record<string, string | boolean> });
    } else {
      // Terminal failure: never leave the panel on infinite Loading.
      // The safe generic copy below hides RPC/auth internals; the GAME_*
      // diagnostic code is the only machine-readable detail surfaced.
      const d = (body as { diagnostic?: unknown } | null)?.diagnostic;
      setLoadState({
        status: "error",
        diagnostic: typeof d === "string" && d.startsWith("GAME_") ? d : null,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  const game = loadState.status === "success" ? loadState.game : null;

  const flip = async (paused: boolean) => {
    setNote(null);
    if (!address) {
      setNote("Connect the authority wallet first.");
      return;
    }
    setBusy(true);
    try {
      const { ok, body } = await api("/api/admin/game/pause-tx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused }),
      });
      if (!ok) {
        setNote((body as { error?: string })?.error ?? "Could not build transaction.");
        return;
      }
      const b64 = (body as { transactionBase64?: string })?.transactionBase64 ?? "";
      const raw = Buffer.from(b64, "base64");
      const tx = Transaction.from(Uint8Array.from(raw));
      const sig = await signAndSendAdmin(tx);
      setNote(`Submitted: ${sig.slice(0, 12)}… — refreshing state.`);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message.slice(0, 160) : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="On-chain game switch">
        {loadState.status === "loading" ? (
          <p className="text-[13px] text-[var(--text-secondary)]">Loading…</p>
        ) : loadState.status === "error" ? (
          <div>
            <p role="alert" className="text-[13px] text-[#ff9db1]">Could not load on-chain game state.</p>
            {loadState.diagnostic && (
              <p className="mt-1 font-mono text-[11px] text-white/50">Diagnostic: {loadState.diagnostic}</p>
            )}
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 rounded-2xl bg-white/10 px-4 py-2 text-[12px] font-bold text-white hover:bg-white/15"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <p className="text-[13px] text-white">
              Paused: <strong>{String(game?.paused)}</strong> • Tier active: <strong>{String(game?.tier1Active)}</strong>
            </p>
            <p className="mt-1 break-all font-mono text-[11px] text-white/50">Authority: {String(game?.authority)}</p>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy} onClick={() => void flip(true)} className="rounded-2xl bg-[#ff5d7a] px-4 py-2 text-[12px] font-bold text-white disabled:opacity-60">
                Pause Game
              </button>
              <button type="button" disabled={busy} onClick={() => void flip(false)} className="rounded-2xl bg-[var(--heads)] px-4 py-2 text-[12px] font-bold text-[#04120d] disabled:opacity-60">
                Resume Game
              </button>
            </div>
            <p className="mt-2 text-[11px] text-white/40">Signed by the connected on-chain authority wallet. No private keys on the server.</p>
          </>
        )}
        {note && <p role="status" className="mt-2 text-[12px] text-white/70">{note}</p>}
      </Section>
    </div>
  );
}

export function SettingsTab() {
  const [rows, setRows] = useState<Array<{ key: string; value: unknown }>>([]);
  const [key, setKey] = useState("announcement_text");
  const [value, setValue] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [assetName, setAssetName] = useState("hero");

  const load = useCallback(async () => {
    const { body } = await api("/api/admin/settings");
    setRows(((body as { settings?: Array<{ key: string; value: unknown }> })?.settings ?? []));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setNote(null);
    let v: unknown = value;
    if (key === "chat_enabled" || key === "leaderboard_enabled") {
      v = value.trim().toLowerCase() === "true";
    }
    const { ok, body } = await api("/api/admin/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value: v }),
    });
    setNote(ok ? "Saved." : ((body as { error?: string })?.error ?? "Save failed."));
    if (ok) {
      setValue("");
      await load();
    }
  };

  const upload = async () => {
    setNote(null);
    if (!file) {
      setNote("Choose a file first.");
      return;
    }
    const form = new FormData();
    form.append("asset", file);
    form.append("name", assetName.trim() || "hero");
    try {
      const r = await fetch("/api/admin/assets", { method: "POST", body: form });
      const b = (await r.json().catch(() => null)) as { error?: string; url?: string } | null;
      setNote(r.ok ? `Uploaded: ${b?.url ?? ""}` : (b?.error ?? "Upload failed."));
    } catch {
      setNote("Upload failed.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Site settings (controlled)">
        <div className="flex flex-col gap-2">
          <label className="text-[12px] font-bold text-white" htmlFor="adm-set-key">Key</label>
          <select id="adm-set-key" value={key} onChange={(e) => setKey(e.target.value)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white">
            {["announcement_text", "hero_subtitle", "coin_heads_url", "coin_tails_url", "coin_default_url", "chat_enabled", "leaderboard_enabled"].map((k) => (
              <option key={k} value={k} className="bg-black">{k}</option>
            ))}
          </select>
          <label className="text-[12px] font-bold text-white" htmlFor="adm-set-val">Value</label>
          <input id="adm-set-val" value={value} onChange={(e) => setValue(e.target.value)} placeholder="text, image URL/path, or true/false" className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white" />
          <button type="button" onClick={() => void save()} className="rounded-2xl bg-white px-4 py-2 text-[13px] font-bold text-black">Save setting</button>
        </div>
        <ul className="mt-3 flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.key} className="break-all rounded-xl bg-white/5 px-3 py-2 font-mono text-[11px] text-white/70">
              {r.key}: {JSON.stringify(r.value)?.slice(0, 120)}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Site assets (validated images)">
        <div className="flex flex-col gap-2">
          <input value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="asset name" className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white" />
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[12px] text-white/70" />
          <button type="button" onClick={() => void upload()} className="rounded-2xl bg-white px-4 py-2 text-[13px] font-bold text-black">Upload</button>
        </div>
        {note && <p role="status" className="mt-2 break-all text-[12px] text-white/70">{note}</p>}
      </Section>
    </div>
  );
}

export function AuditTab() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    void api("/api/admin/audit?limit=100").then(({ body }) => {
      setRows(((body as { entries?: Array<Record<string, unknown>> })?.entries ?? []));
    });
  }, []);
  return (
    <Section title="Admin audit log">
      <ul className="flex max-h-[480px] flex-col gap-1.5 overflow-y-auto">
        {rows.map((r) => (
          <li key={String(r.id)} className="rounded-xl bg-white/5 px-3 py-2 text-[12px]">
            <p className="font-bold text-white">{String(r.action)} <span className="font-medium text-white/50">by {shortWallet(String(r.admin_wallet ?? ""))}</span></p>
            <p className="break-all text-white/50">{r.target ? `target ${shortWallet(String(r.target))} • ` : ""}{String(r.created_at ?? "").slice(0, 19).replace("T", " ")}</p>
          </li>
        ))}
        {rows.length === 0 && <p className="text-[12px] text-white/50">No audit entries yet.</p>}
      </ul>
    </Section>
  );
}
