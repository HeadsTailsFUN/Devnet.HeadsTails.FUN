"use client";

import { useCallback, useState } from "react";
import type { WelcomeGrantDiagnosticFacts } from "@/lib/solana/welcomeGrantDiagnostic";

/**
 * HT-OBS micro-fix: Devnet-only welcome-grant diagnostic card for Admin →
 * Overview (rendered only for OWNER/FULL_ADMIN on Devnet; the page gates
 * with `canWebAdmin && IS_DEVNET` and the endpoint fail-closes on Mainnet).
 *
 * Calls the existing authenticated `GET /api/admin/welcome-grant-diagnostic`
 * from the page session (direct navigation is blocked for unauthenticated
 * clients) and renders SAFE fields only: diagnostic code, RPC configured,
 * faucet key configured/valid, public faucet address, faucet SOL, treasury
 * balance, mint, plus other non-secret fields. Never private keys, secret
 * env values, service-role keys, or raw signer material.
 *
 * Transfer semantics are untouched — this is read-only observability.
 */

type CardState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: WelcomeGrantDiagnosticFacts }
  | { status: "error"; httpStatus: number | null; message: string };

function yesNo(v: boolean): string {
  return v ? "Yes" : "No";
}

export function WelcomeGrantDiagnosticCard() {
  const [state, setState] = useState<CardState>({ status: "idle" });

  const check = useCallback(async () => {
    setState({ status: "loading" });
    let httpStatus: number | null = null;
    try {
      const r = await fetch("/api/admin/welcome-grant-diagnostic", { cache: "no-store" });
      httpStatus = r.status;
      const b = (await r.json().catch(() => null)) as Partial<WelcomeGrantDiagnosticFacts> & {
        error?: unknown;
      } | null;
      if (r.ok && b && typeof b.code === "string") {
        // Whitelist SAFE fields only — never echo unknown payload keys that
        // could one day carry secret material.
        setState({
          status: "success",
          data: {
            code: b.code,
            faucetPubkey: typeof b.faucetPubkey === "string" ? b.faucetPubkey : null,
            mint: typeof b.mint === "string" ? b.mint : null,
            treasuryAta: typeof b.treasuryAta === "string" ? b.treasuryAta : null,
            faucetSolLamports: typeof b.faucetSolLamports === "number" ? b.faucetSolLamports : null,
            treasuryBalanceBaseUnits:
              typeof b.treasuryBalanceBaseUnits === "string" ? b.treasuryBalanceBaseUnits : null,
            rpcIsDedicated: b.rpcIsDedicated === true,
            rpcMissing: b.rpcMissing !== false,
            config: {
              supabaseUrlSet: b.config?.supabaseUrlSet === true,
              serviceRoleSet: b.config?.serviceRoleSet === true,
              faucetKeySet: b.config?.faucetKeySet === true,
              faucetEnabled: b.config?.faucetEnabled === true,
              clusterIsDevnet: b.config?.clusterIsDevnet === true,
              mintMatches: b.config?.mintMatches === true,
            },
            recentFailed: typeof b.recentFailed === "number" ? b.recentFailed : null,
            detail: typeof b.detail === "string" ? b.detail.slice(0, 200) : "",
          },
        });
        return;
      }
      const safeError =
        b && typeof b.error === "string" && b.error.length > 0
          ? b.error.slice(0, 160)
          : "Request failed.";
      setState({ status: "error", httpStatus, message: safeError });
    } catch {
      setState({ status: "error", httpStatus, message: "Network error." });
    }
  }, []);

  const d = state.status === "success" ? state.data : null;

  return (
    <section className="glass rounded-3xl p-4">
      <h3 className="font-display text-[15px] font-bold text-white">Welcome Grant Diagnostics</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-white/40">
        Devnet-only operator read-out (safe fields only — no keys or secrets).
      </p>
      <div className="mt-2">
        <button
          type="button"
          onClick={() => void check()}
          disabled={state.status === "loading"}
          className="rounded-2xl bg-white px-4 py-2 text-[12px] font-bold text-black disabled:opacity-60"
        >
          {state.status === "loading" ? "Checking…" : "Check Welcome Grant"}
        </button>
      </div>
      <div className="mt-2">
        {state.status === "idle" && (
          <p className="text-[12px] text-[var(--text-secondary)]">Not checked yet.</p>
        )}
        {state.status === "loading" && (
          <p className="text-[12px] text-[var(--text-secondary)]">Checking…</p>
        )}
        {state.status === "error" && (
          <div>
            <p role="alert" className="text-[12px] text-[#ff9db1]">
              Request failed{state.httpStatus !== null ? ` (HTTP ${state.httpStatus})` : ""}.{" "}
              {state.message}
            </p>
            <button
              type="button"
              onClick={() => void check()}
              className="mt-2 rounded-2xl bg-white/10 px-4 py-2 text-[12px] font-bold text-white hover:bg-white/15"
            >
              Retry
            </button>
          </div>
        )}
        {d && (
          <dl className="grid grid-cols-2 gap-2 text-[12px]">
            <div>
              <dt className="text-white/50">Diagnostic</dt>
              <dd className="font-bold text-white">{d.code}</dd>
            </div>
            <div>
              <dt className="text-white/50">RPC configured</dt>
              <dd className="font-bold text-white">{yesNo(!d.rpcMissing)}</dd>
            </div>
            <div>
              <dt className="text-white/50">Dedicated RPC</dt>
              <dd className="font-bold text-white">{yesNo(d.rpcIsDedicated)}</dd>
            </div>
            <div>
              <dt className="text-white/50">Faucet key configured</dt>
              <dd className="font-bold text-white">{yesNo(d.config.faucetKeySet)}</dd>
            </div>
            <div>
              <dt className="text-white/50">Signer valid</dt>
              <dd className="font-bold text-white">{yesNo(d.faucetPubkey !== null)}</dd>
            </div>
            <div>
              <dt className="text-white/50">Faucet enabled</dt>
              <dd className="font-bold text-white">{yesNo(d.config.faucetEnabled)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-white/50">Faucet (public address)</dt>
              <dd className="break-all font-mono text-[11px] text-white">{d.faucetPubkey ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-white/50">Faucet SOL (lamports)</dt>
              <dd className="font-bold text-white">
                {d.faucetSolLamports !== null ? d.faucetSolLamports.toLocaleString("en-US") : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Treasury balance (base units)</dt>
              <dd className="font-bold text-white">{d.treasuryBalanceBaseUnits ?? "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-white/50">Mint</dt>
              <dd className="break-all font-mono text-[11px] text-white">{d.mint ?? "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-white/50">Detail</dt>
              <dd className="text-white/80">{d.detail || "—"}</dd>
            </div>
            {d.recentFailed !== null && (
              <div>
                <dt className="text-white/50">Recent failed grants</dt>
                <dd className="font-bold text-white">{d.recentFailed}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </section>
  );
}
