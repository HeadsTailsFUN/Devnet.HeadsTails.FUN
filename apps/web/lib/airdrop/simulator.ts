/**
 * In-memory simulator of the atomic growth RPCs (create/review/edit social
 * claim, qualify referral, award referral game, event-day gameplay award).
 * Mirrors the SQL semantics in
 * supabase/migrations/20260929000000_growth_systems.sql (+
 * 20260929000002_gameplay_event_day_idempotency.sql,
 * 20260929000003_social_claim_edit.sql) — including per-key serialization
 * that models pg_advisory_xact_lock / FOR UPDATE — so contract tests
 * (conflicts, idempotency, caps, atomicity) run without a database.
 * Live Postgres proves the real functions (see proof scripts).
 */

export interface SimClaim {
  id: string;
  season_id: string;
  wallet: string;
  x_user_id: string | null;
  x_handle: string;
  task_type: string;
  status: "pending" | "verified" | "rejected";
  reviewer_wallet?: string | null;
  review_note?: string | null;
  reviewed_at?: string | null;
  evidence_url?: string | null;
}

export interface SimLedger {
  season_id: string;
  wallet: string;
  category?: string;
  event_type: string;
  source_key: string;
  points: number;
  status: "pending" | "verified" | "rejected";
  verified_at?: string | null;
  metadata?: Record<string, unknown>;
  /** Sim-only: explicit event day for seeded legacy rows (SQL: created_at day). */
  day?: string;
}

export interface SimIdentity {
  id: string;
  season_id: string;
  wallet: string;
  x_user_id: string | null;
  x_handle: string;
  status: "pending" | "verified" | "rejected";
  verified_at?: string | null;
}

export interface SimAttr {
  invitee_wallet: string;
  referrer_wallet: string;
  referral_code: string;
  status: "pending" | "qualified" | "blocked";
  qualified_at?: string | null;
}

export interface SimDb {
  claims: SimClaim[];
  ledger: SimLedger[];
  identities: SimIdentity[];
  attrs: SimAttr[];
  seasonId: string;
  /** Fault injection: fail the next ledger write inside qualify (atomicity proof). */
  failNextLedgerWrite?: boolean;
}

const norm = (h: string) => h.trim().replace(/^@/, "").toLowerCase();

/** Async mutex per key: models FOR UPDATE / advisory-xact serialization. */
export class KeyMutex {
  private tails = new Map<string, Promise<void>>();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const cur = new Promise<void>((r) => {
      release = r;
    });
    this.tails.set(key, prev.then(() => cur));
    await prev;
    // Yield so concurrent callers genuinely interleave without the lock.
    await new Promise((r) => setImmediate(r));
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const tick = () => new Promise((r) => setImmediate(r));

export function rpcResult(data: unknown, error: unknown = null) {
  return { data, error };
}

export async function simRpc(
  store: SimDb,
  mutex: KeyMutex,
  name: string,
  args: Record<string, any>
): Promise<{ data: any; error: any }> {
  if (name === "create_airdrop_social_claim_atomic") {
    return mutex.run(`claim:${args.p_season_id}:${args.p_wallet}:${args.p_task_type}`, async () => {
      await tick();
      const existingIdent = store.identities.find(
        (i) => i.season_id === args.p_season_id && i.wallet === args.p_wallet
      );
      if (existingIdent && norm(existingIdent.x_handle) !== norm(args.p_handle)) {
        return rpcResult(null, { message: "wallet-bound" });
      }
      if (!existingIdent) {
        store.identities.push({
          id: `id-${store.identities.length}`,
          season_id: args.p_season_id,
          wallet: args.p_wallet,
          x_user_id: args.p_x_user_id ?? null,
          x_handle: args.p_handle,
          status: "pending",
        });
      }
      const taken = store.identities.some(
        (i) =>
          i.season_id === args.p_season_id &&
          i.status === "verified" &&
          i.wallet !== args.p_wallet &&
          norm(i.x_handle) === norm(args.p_handle)
      );
      if (taken) return rpcResult(null, { message: "x-taken" });
      const dup = store.claims.find(
        (c) => c.season_id === args.p_season_id && c.wallet === args.p_wallet && c.task_type === args.p_task_type
      );
      if (dup) return rpcResult({ status: "already-claimed", claim_id: dup.id }, null);
      const id = `c-${store.claims.length}-${Date.now()}`;
      store.claims.push({
        id,
        season_id: args.p_season_id,
        wallet: args.p_wallet,
        x_user_id: args.p_x_user_id ?? null,
        x_handle: args.p_handle,
        task_type: args.p_task_type,
        status: "pending",
        evidence_url: args.p_evidence_url ?? null,
      });
      await tick();
      store.ledger.push({
        season_id: args.p_season_id,
        wallet: args.p_wallet,
        event_type: `social_${args.p_task_type}`,
        source_key: id,
        points: args.p_points,
        status: "pending",
        metadata: { claimId: id },
      });
      return rpcResult({ status: "created", claim_id: id }, null);
    });
  }

  // Social claim edit (mirrors 20260929000003_social_claim_edit.sql):
  // handle/evidence updates move the SAME rows back to pending — never a
  // second reward row. Same value -> unchanged.
  if (name === "update_airdrop_social_claim_atomic") {
    return mutex.run(`edit:${args.p_season_id}:${args.p_wallet}:${args.p_task_type}`, async () => {
      await tick();
      const ident = store.identities.find(
        (i) => i.season_id === args.p_season_id && i.wallet === args.p_wallet
      );
      if (!ident) return rpcResult(null, { message: "no-identity" });
      const claim = store.claims.find(
        (c) => c.season_id === args.p_season_id && c.wallet === args.p_wallet && c.task_type === args.p_task_type
      );
      if (!claim) return rpcResult(null, { message: "no-claim" });
      const event = `social_${args.p_task_type}`;
      const row = store.ledger.find(
        (l) => l.source_key === claim.id && l.event_type === event
      );
      const toPending = () => {
        claim.status = "pending";
        claim.reviewer_wallet = null;
        claim.review_note = null;
        claim.reviewed_at = null;
        if (row) {
          row.status = "pending";
          row.verified_at = null;
        }
      };
      if (args.p_task_type === "connect_x") {
        if (norm(ident.x_handle) === norm(args.p_handle)) {
          return rpcResult({ status: "unchanged", claim_id: claim.id }, null);
        }
        const taken =
          store.identities.some(
            (i) =>
              i.season_id === args.p_season_id &&
              i.status === "verified" &&
              i.wallet !== args.p_wallet &&
              norm(i.x_handle) === norm(args.p_handle)
          ) ||
          store.claims.some(
            (c) =>
              c.season_id === args.p_season_id &&
              c.status === "verified" &&
              c.wallet !== args.p_wallet &&
              norm(c.x_handle) === norm(args.p_handle)
          );
        if (taken) return rpcResult(null, { message: "x-taken" });
        ident.x_handle = args.p_handle;
        ident.status = "pending";
        claim.x_handle = args.p_handle;
        toPending();
        return rpcResult({ status: "edited", claim_id: claim.id }, null);
      }
      if (norm(ident.x_handle) !== norm(args.p_handle) && norm(claim.x_handle) !== norm(args.p_handle)) {
        return rpcResult(null, { message: "wallet-bound" });
      }
      if ((claim as unknown as { evidence_url?: string }).evidence_url === (args.p_evidence_url ?? null)) {
        return rpcResult({ status: "unchanged", claim_id: claim.id }, null);
      }
      (claim as unknown as { evidence_url?: string }).evidence_url = args.p_evidence_url ?? null;
      toPending();
      return rpcResult({ status: "edited", claim_id: claim.id }, null);
    });
  }

  if (name === "review_airdrop_social_claim_atomic") {
    return mutex.run(`review:${args.p_claim_id}`, async () => {
      await tick();
      const claim = store.claims.find((c) => c.id === args.p_claim_id);
      if (!claim) return rpcResult(null, { message: "claim-not-found" });
      if (args.p_decision !== "verified" && args.p_decision !== "rejected") {
        return rpcResult(null, { message: "invalid-decision" });
      }
      if (args.p_decision === "verified") {
        const ident = store.identities.find(
          (i) => i.season_id === claim.season_id && i.wallet === claim.wallet
        );
        if (ident && norm(ident.x_handle) !== norm(claim.x_handle)) {
          return rpcResult(null, { message: "wallet-bound" });
        }
        const clash =
          store.identities.some(
            (i) =>
              i.season_id === claim.season_id &&
              i.status === "verified" &&
              i.wallet !== claim.wallet &&
              norm(i.x_handle) === norm(claim.x_handle)
          ) ||
          store.claims.some(
            (c) =>
              c.season_id === claim.season_id &&
              c.status === "verified" &&
              c.wallet !== claim.wallet &&
              norm(c.x_handle) === norm(claim.x_handle)
          );
        if (clash) return rpcResult(null, { message: "x-taken" });
        claim.status = "verified";
        claim.reviewer_wallet = args.p_reviewer;
        claim.review_note = args.p_note ?? null;
        const row = store.ledger.find(
          (l) => l.source_key === claim.id && l.event_type === `social_${claim.task_type}`
        );
        if (row) row.status = "verified";
        if (ident) {
          ident.status = "verified";
          if (!ident.x_handle) ident.x_handle = claim.x_handle;
        } else {
          store.identities.push({
            id: `id-${store.identities.length}`,
            season_id: claim.season_id,
            wallet: claim.wallet,
            x_user_id: claim.x_user_id,
            x_handle: claim.x_handle,
            status: "verified",
          });
        }
        return rpcResult({ status: "verified", claim_id: claim.id }, null);
      }
      claim.status = "rejected";
      claim.reviewer_wallet = args.p_reviewer;
      claim.review_note = args.p_note ?? null;
      const row = store.ledger.find(
        (l) => l.source_key === claim.id && l.event_type === `social_${claim.task_type}`
      );
      if (row) {
        row.status = "rejected";
        row.verified_at = null;
      }
      const siblings = store.claims.some(
        (c) => c.season_id === claim.season_id && c.wallet === claim.wallet && c.status === "verified"
      );
      const ident = store.identities.find(
        (i) => i.season_id === claim.season_id && i.wallet === claim.wallet
      );
      if (ident) ident.status = siblings ? "verified" : "rejected";
      return rpcResult({ status: "rejected", claim_id: claim.id }, null);
    });
  }

  // Event-day gameplay award (mirrors 20260929000002_gameplay_event_day_
  // idempotency.sql): cap day + lock key come from p_settled_at (authoritative
  // event time). The gameplay_match marker is ALWAYS written (even 0 points
  // when capped); replays return exists; omitted winner bonuses are final.
  if (name === "award_gameplay_match_atomic") {
    if (!args.p_settled_at) return rpcResult(null, { message: "missing-settled-at" });
    const eventDay = String(args.p_settled_at).slice(0, 10);
    const dayOf = (l: SimLedger): string =>
      (l.metadata?.event_day as string) ?? l.day ?? eventDay;
    return mutex.run(`game:${args.p_season_id}:${args.p_wallet}:${eventDay}`, async () => {
      await tick();
      const gameExists = store.ledger.some(
        (l) => l.season_id === args.p_season_id && l.wallet === args.p_wallet && l.event_type === "gameplay_match" && l.source_key === args.p_match_id
      );
      // Marker presence ends processing: no bonus top-up on later days, ever.
      if (gameExists) {
        return rpcResult({ status: "exists" }, null);
      }
      const current = store.ledger
        .filter(
          (l) =>
            l.season_id === args.p_season_id &&
            l.wallet === args.p_wallet &&
            (l.category === "gameplay" || l.category === "win_bonus" || l.event_type === "gameplay_match" || l.event_type === "win_bonus_match") &&
            l.status === "verified" &&
            dayOf(l) === eventDay
        )
        .reduce((s, l) => s + l.points, 0);
      let allow = Math.max(0, 200 - current);
      const entryAllow = allow;
      let gamePts = 0;
      let bonusPts = 0;
      gamePts = Math.min(2, allow);
      await tick();
      store.ledger.push({
        season_id: args.p_season_id,
        wallet: args.p_wallet,
        category: "gameplay",
        event_type: "gameplay_match",
        source_key: args.p_match_id,
        points: gamePts,
        status: "verified",
        metadata: { matchId: args.p_match_id, event_day: eventDay, capped: entryAllow <= 0 },
      });
      allow -= gamePts;
      // Winner bonus only from the SAME event day's remaining room. Omitted
      // bonuses are final (the marker above makes replays return exists).
      if (args.p_is_winner && allow > 0) {
        bonusPts = Math.min(3, allow);
        store.ledger.push({
          season_id: args.p_season_id,
          wallet: args.p_wallet,
          category: "win_bonus",
          event_type: "win_bonus_match",
          source_key: args.p_match_id,
          points: bonusPts,
          status: "verified",
          metadata: { matchId: args.p_match_id, event_day: eventDay },
        });
        allow -= bonusPts;
      }
      if (entryAllow <= 0) return rpcResult({ status: "capped", day_total: current, event_day: eventDay }, null);
      if (gamePts < 2 || (args.p_is_winner && bonusPts < 3)) {
        return rpcResult({ status: "partial", gameplay: gamePts, win_bonus: bonusPts, event_day: eventDay }, null);
      }
      return rpcResult({ status: "awarded", gameplay: gamePts, win_bonus: bonusPts, event_day: eventDay }, null);
    });
  }

  if (name === "qualify_referral_atomic") {
    return mutex.run(`qual:${args.p_invitee}`, async () => {
      await tick();
      const attr = store.attrs.find((a) => a.invitee_wallet === args.p_invitee);
      if (!attr) return rpcResult(null, { message: "not-attributed" });
      if (attr.referrer_wallet !== args.p_referrer) {
        return rpcResult(null, { message: "referrer-mismatch" });
      }
      if (attr.status === "qualified") {
        ensureBonus(store, args as { p_season_id: string; p_invitee: string; p_referrer: string });
        return rpcResult({ status: "already-qualified" }, null);
      }
      if (attr.status !== "pending") return rpcResult(null, { message: "invalid-attribution-state" });
      // Atomic: fault injection aborts BEFORE any mutation (like a tx rollback).
      if (store.failNextLedgerWrite) {
        store.failNextLedgerWrite = false;
        return rpcResult(null, { message: "ledger write failed" });
      }
      await tick();
      ensureBonus(store, args as { p_season_id: string; p_invitee: string; p_referrer: string });
      attr.status = "qualified";
      attr.qualified_at = new Date().toISOString();
      return rpcResult({ status: "qualified" }, null);
    });
  }

  if (name === "award_referral_game_atomic") {
    return mutex.run(`award:${args.p_referrer}`, async () => {
      await tick();
      const key = `${args.p_match_id}:${args.p_invitee}`;
      if (
        store.ledger.some(
          (l) => l.season_id === args.p_season_id && l.wallet === args.p_referrer && l.event_type === "referral_game" && l.source_key === key
        )
      ) {
        return rpcResult({ status: "exists" }, null);
      }
      const mine = store.ledger.filter(
        (l) =>
          l.season_id === args.p_season_id &&
          l.wallet === args.p_referrer &&
          l.event_type === "referral_game" &&
          l.status === "verified" &&
          (l.metadata as any)?.invitee === args.p_invitee
      );
      if (mine.length >= 25) return rpcResult({ status: "capped-invitee" }, null);
      const recurring = store.ledger
        .filter(
          (l) =>
            l.season_id === args.p_season_id &&
            l.wallet === args.p_referrer &&
            l.event_type === "referral_game" &&
            l.status === "verified"
        )
        .reduce((s, l) => s + l.points, 0);
      if (recurring + 2 > 500) return rpcResult({ status: "capped-referrer" }, null);
      await tick();
      store.ledger.push({
        season_id: args.p_season_id,
        wallet: args.p_referrer,
        event_type: "referral_game",
        source_key: key,
        points: 2,
        status: "verified",
        metadata: { invitee: args.p_invitee, matchId: args.p_match_id },
      });
      return rpcResult({ status: "awarded" }, null);
    });
  }

  return rpcResult(null, { message: `unknown function ${name}` });
}

function ensureBonus(
  store: SimDb,
  args: { p_season_id: string; p_invitee: string; p_referrer: string }
) {
  if (
    !store.ledger.some(
      (l) => l.wallet === args.p_invitee && l.event_type === "referral_qualify_invitee" && l.source_key === args.p_invitee
    )
  ) {
    store.ledger.push({
      season_id: args.p_season_id,
      wallet: args.p_invitee,
      event_type: "referral_qualify_invitee",
      source_key: args.p_invitee,
      points: 25,
      status: "verified",
      metadata: { referrer: args.p_referrer },
    });
  }
  if (
    !store.ledger.some(
      (l) => l.wallet === args.p_referrer && l.event_type === "referral_qualify_referrer" && l.source_key === args.p_invitee
    )
  ) {
    store.ledger.push({
      season_id: args.p_season_id,
      wallet: args.p_referrer,
      event_type: "referral_qualify_referrer",
      source_key: args.p_invitee,
      points: 50,
      status: "verified",
      metadata: { invitee: args.p_invitee },
    });
  }
}

/** Fake supabase client fronting the simulator (from() reads + rpc()). */
export function simClient(store: SimDb, mutex = new KeyMutex()) {
  return {
    store,
    async rpc(name: string, rpcArgs: Record<string, any>) {
      return simRpc(store, mutex, name, rpcArgs);
    },
    from(table: string) {
      const api: Record<string, any> = {};
      let eq: Array<[string, unknown]> = [];
      api.select = () => api;
      api.eq = (k: string, v: unknown) => {
        eq.push([k, v]);
        return api;
      };
      api.in = (k: string, v: unknown[]) => {
        eq.push([`in:${k}`, v]);
        return api;
      };
      api.gte = () => api;
      api.limit = () => api;
      api.order = () => api;
      const rowsFor = (): Array<any> => {
        if (table === "airdrop_social_claims") return store.claims;
        if (table === "airdrop_x_identities") return store.identities;
        if (table === "airdrop_points_ledger") return store.ledger;
        if (table === "referral_attributions") return store.attrs;
        if (table === "admin_members") return [];
        if (table === "reward_exclusions") return [];
        if (table === "matches") return [];
        return [];
      };
      const filtered = () =>
        rowsFor().filter((r) =>
          eq.every(([k, v]) => {
            if (k.startsWith("in:")) return ((v as unknown[]) ?? []).includes((r as any)[k.slice(3)]);
            return (r as any)[k] === v;
          })
        );
      api.maybeSingle = async () => ({ data: filtered()[0] ?? null, error: null });
      api.then = (resolve: (v: { data: unknown; error: null; count?: number }) => unknown) =>
        Promise.resolve({ data: filtered(), error: null, count: filtered().length }).then(resolve);
      api.upsert = async (row: any) => {
        if (table === "airdrop_points_ledger") {
          const hit = store.ledger.find(
            (l) =>
              l.season_id === row.season_id && l.wallet === row.wallet && l.event_type === row.event_type && l.source_key === row.source_key
          );
          if (!hit) store.ledger.push({ ...row });
          return { error: null };
        }
        return { error: null };
      };
      return api;
    },
  };
}
