"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { dedupeWallets, walletRowKey } from "@/lib/solana/wallets";
import { classifyError, classifySigningError } from "@/lib/solana/errors";
import {
  describeAccountForDiagnostics,
  describeWalletForDiagnostics,
  getConnectMethod,
  getDisconnectMethod,
  getSignMethod,
  normalizeSigningOutput,
  selectSolanaAccount,
} from "@/lib/solana/walletStandard";
import {
  forgetWallet,
  getRememberedWallet,
  rememberWallet,
} from "@/lib/solana/session";
import { IS_DEVNET } from "@/lib/solana/cluster";

// Re-exported for existing callers/tests; implementation lives in walletStandard.
export { normalizeSigningOutput };

function dbg(stage: string, data?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "production") return;
  try {
    console.debug(`[wallet:${stage}]`, data ?? {});
  } catch {
    // ignore
  }
}

export interface WalletState {
  wallets: Wallet[];
  account: WalletAccount | null;
  wallet: Wallet | null;
  connecting: boolean;
  restoring: boolean;
  error: string | null;
  errorCode: string | null;
  connect: (wallet: Wallet) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Sign raw transaction bytes with the connected account. */
  signBytes: (txBytes: Uint8Array) => Promise<Uint8Array>;
}

const WalletContext = createContext<WalletState | null>(null);

export function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export function walletKey(w: Wallet): string {
  return walletRowKey(w);
}

const EXPECTED_CHAIN = IS_DEVNET ? "solana:devnet" : "solana:mainnet";

export function WalletStandardProvider({ children }: { children: ReactNode }) {
  const [rawWallets, setRawWallets] = useState<Wallet[]>([]);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const restoredRef = useRef(false);

  const wallets = useMemo(
    () => dedupeWallets(rawWallets, EXPECTED_CHAIN),
    [rawWallets]
  );

  useEffect(() => {
    const api = getWallets();
    const refresh = () => {
      try {
        setRawWallets([...api.get()]);
      } catch {
        // registry read failure: keep previous list
      }
    };
    refresh();
    const off = api.on("register", refresh);
    return typeof off === "function" ? off : () => undefined;
  }, []);

  const fail = useCallback((e: unknown) => {
    const c = classifyError(e);
    setError(c.message);
    setErrorCode(c.code);
    dbg("error", { code: c.code, technical: c.technical });
  }, []);

  const doConnect = useCallback(async (w: Wallet, opts: { silent?: boolean; remember?: boolean }) => {
    const diag = describeWalletForDiagnostics(w);
    dbg("wallet-selected", {
      wallet: diag.name,
      features: diag.features,
      chains: diag.chains,
      accounts: diag.accountCount,
    });
    // Direct Wallet Standard access: wallet.features["standard:connect"]
    // already IS { version, connect }. No nested lookup.
    const connect = getConnectMethod(w);
    if (!connect) {
      throw new Error("WALLET_CONNECT_UNSUPPORTED: wallet does not support standard:connect");
    }
    // Stage 2: feature lookup done; Stage 3: connect request.
    const out = await connect(opts.silent ? { silent: true } : undefined);
    if (!out || !Array.isArray(out.accounts)) {
      throw new Error("WALLET_SIGNING_INVALID_OUTPUT: wallet connect returned no accounts");
    }
    for (const a of out.accounts) {
      try {
        dbg("account-seen", describeAccountForDiagnostics(a) as unknown as Record<string, unknown>);
      } catch {
        // diagnostics must never break connect
      }
    }
    // Deterministic Solana signing-account selection (never blind accounts[0],
    // which may be an EVM/non-Solana account on multi-chain wallets).
    const chosen = selectSolanaAccount(out.accounts, EXPECTED_CHAIN);
    if (!chosen) {
      throw new Error(
        "WALLET_SIGNING_UNSUPPORTED: wallet returned no Solana account supporting solana:signTransaction"
      );
    }
    dbg("connect-response", {
      wallet: diag.name,
      accounts: out.accounts.length,
      chain: chosen.chains.find((c) => c === EXPECTED_CHAIN) ?? chosen.chains[0],
    });
    setWallet(w);
    setAccount(chosen);
    if (opts.remember !== false && !opts.silent) {
      try {
        rememberWallet((w as { name: string }).name);
      } catch {
        // ignore
      }
    }
  }, []);

  const connect = useCallback(
    async (w: Wallet) => {
      setConnecting(true);
      setError(null);
      setErrorCode(null);
      try {
        await doConnect(w, {});
      } catch (e) {
        fail(e);
      } finally {
        setConnecting(false);
      }
    },
    [doConnect, fail]
  );

  // Silent restore of the previously authorized provider after refresh.
  useEffect(() => {
    if (restoredRef.current) return;
    if (rawWallets.length === 0) return;
    restoredRef.current = true;
    const run = async () => {
      try {
        const remembered = getRememberedWallet();
        if (!remembered) {
          setRestoring(false);
          return;
        }
        const deduped = dedupeWallets(rawWallets, EXPECTED_CHAIN);
        const target =
          deduped.find((w) => (w as { name: string }).name === remembered) ??
          null;
        if (!target) {
          // Wallet extension unavailable during reconnect: fall back cleanly.
          dbg("restore-miss", { remembered });
          setRestoring(false);
          return;
        }
        try {
          await doConnect(target, { silent: true, remember: true });
          dbg("restore-ok", { wallet: remembered });
        } catch (e) {
          // Silent reconnect fails (locked, unavailable, account changed):
          // fall back cleanly to disconnected state without popups.
          dbg("restore-fail", { wallet: remembered, err: e instanceof Error ? e.message : String(e) });
          setWallet(null);
          setAccount(null);
        }
      } finally {
        setRestoring(false);
      }
    };
    void run();
  }, [rawWallets, doConnect]);

  const disconnect = useCallback(async () => {
    try {
      // Direct Wallet Standard access: features["standard:disconnect"] IS
      // { version, disconnect }. No nested lookup.
      const disc = wallet ? getDisconnectMethod(wallet) : null;
      if (disc) await disc();
    } catch {
      // Local state is the source of truth for disconnect.
    } finally {
      setWallet(null);
      setAccount(null);
      try {
        forgetWallet();
      } catch {
        // ignore
      }
    }
  }, [wallet]);

  const signBytes = useCallback(
    async (txBytes: Uint8Array): Promise<Uint8Array> => {
      if (!wallet || !account) throw new Error("wallet not connected");
      dbg("tx-construct", { bytes: txBytes.length });
      // Direct Wallet Standard access: features["solana:signTransaction"] IS
      // { version, supportedTransactionVersions, signTransaction }.
      const sign = getSignMethod(wallet);
      if (!sign) {
        throw new Error("WALLET_SIGNING_UNSUPPORTED: wallet does not support solana:signTransaction");
      }
      const chains = Array.isArray(account.chains) ? account.chains : [];
      const chain =
        chains.find((c) => c === EXPECTED_CHAIN) ??
        chains.find((c) => c.startsWith("solana:")) ??
        EXPECTED_CHAIN;
      dbg("sign-request", { wallet: (wallet as { name?: string }).name, chain, bytes: txBytes.length });
      let raw: unknown;
      try {
        raw = await sign({ transaction: txBytes, account, chain });
      } catch (e) {
        dbg("sign-error", { err: e instanceof Error ? e.message : String(e) });
        throw classifySigningError("sign-request", e);
      }
      dbg("sign-response", {
        isArray: Array.isArray(raw),
        len: Array.isArray(raw) ? (raw as unknown[]).length : undefined,
        keys: raw && typeof raw === "object" && !Array.isArray(raw) ? Object.keys(raw as object) : undefined,
      });
      try {
        const out = normalizeSigningOutput(raw);
        dbg("sign-normalized", { bytes: out.length });
        return out;
      } catch (e) {
        throw classifySigningError("sign-response", e);
      }
    },
    [wallet, account]
  );

  const value = useMemo<WalletState>(
    () => ({
      wallets,
      account,
      wallet,
      connecting,
      restoring,
      error,
      errorCode,
      connect,
      disconnect,
      signBytes,
    }),
    [wallets, account, wallet, connecting, restoring, error, errorCode, connect, disconnect, signBytes]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWalletState(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWalletState must be used inside WalletStandardProvider");
  return ctx;
}
