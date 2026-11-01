use anchor_lang::prelude::*;

pub const SIDE_HEADS: u8 = 0;
pub const SIDE_TAILS: u8 = 1;

/// Tier identifiers in USD. V1 supported only $1; V2 adds $10 as a real
/// independent room. $100/$1000 remain disabled ("Opening Soon") and are
/// rejected on-chain. Note: u8 cannot encode 1000, so $1000 will need a
/// tier-encoding migration when it is eventually enabled; it is NOT
/// silently mapped to a truncated value.
pub const TIER_1_USD: u8 = 1;
pub const TIER_10_USD: u8 = 10;
pub const TIER_100_USD: u8 = 100;

/// Tiers with real independent on-chain rooms in this build.
pub const SUPPORTED_TIERS: [u8; 2] = [TIER_1_USD, TIER_10_USD];

pub fn is_supported_tier(tier_usd: u8) -> bool {
    tier_usd == TIER_1_USD || tier_usd == TIER_10_USD
}

/// Queue entry lifecycle. Cancelled entries leave holes that the matcher
/// must provably skip via on-chain account validation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum EntryStatus {
    Active,
    Cancelled,
    Matched,
}

/// Match lifecycle. Randomness is observed and consumed atomically inside
/// `settle_match`, so no intermediate state is required.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MatchState {
    WaitingForRandomness,
    Settled,
}

/// Flip outcome derived deterministically from fulfilled VRF bytes.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum FlipResult {
    Heads,
    Tails,
}

impl FlipResult {
    pub fn side(&self) -> u8 {
        match self {
            FlipResult::Heads => SIDE_HEADS,
            FlipResult::Tails => SIDE_TAILS,
        }
    }
}

/// Global game configuration. The single source of queue head/next indices,
/// so FIFO order is authoritative on-chain.
#[account]
#[derive(InitSpace)]
pub struct GameConfig {
    pub authority: Pubkey,
    pub project_mint: Pubkey,
    pub paused: bool,
    pub tier1_active: bool,
    pub heads_head: u64,
    pub heads_next: u64,
    pub tails_head: u64,
    pub tails_next: u64,
    pub total_matches: u64,
    pub vault_bump: u8,
    pub authority_bump: u8,
    pub config_bump: u8,
}

/// Per-wallet activity guard. V1 allows exactly one active queue entry or
/// one unresolved match per wallet — V2 keeps the same global rule across
/// ALL rooms (a wallet may NOT sit in $1 and $10 simultaneously).
/// `queued_tier_usd` / `match_tier_usd` give the room context needed to
/// recover state correctly (0 = none/legacy-idle, 1 = $1 legacy default).
#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub player: Pubkey,
    pub queued: bool,
    pub queued_side: u8,
    pub queued_sequence: u64,
    pub in_match: bool,
    pub match_id: u64,
    pub bump: u8,
    pub queued_tier_usd: u8,
    pub match_tier_usd: u8,
}

/// One FIFO queue slot. PDAs are deterministic in (side, sequence), so any
/// client can resolve the current head address off-chain.
/// NOTE: legacy V1 global queue. Preserved for settled-history and drain;
/// new rooms use RoomQueueEntry below with tier-scoped PDAs.
#[account]
#[derive(InitSpace)]
pub struct QueueEntry {
    pub player: Pubkey,
    pub side: u8,
    pub sequence: u64,
    pub amount: u64,
    pub joined_slot: u64,
    pub status: EntryStatus,
    pub bump: u8,
}

/// Tier-scoped room state: independent FIFO pointers per real room.
/// PDA: ["room", tier_usd_byte]. `total_matches` stays global in GameConfig.
#[account]
#[derive(InitSpace)]
pub struct RoomState {
    pub tier_usd: u8,
    pub active: bool,
    pub heads_head: u64,
    pub heads_next: u64,
    pub tails_head: u64,
    pub tails_next: u64,
    pub bump: u8,
}

/// Tier-scoped FIFO queue slot. PDA:
/// ["queue", tier_usd_byte, side_byte, sequence_le_bytes].
/// A $1 HEADS entry can NEVER match a $10 TAILS entry: matching only pairs
/// entries from the SAME RoomState/tier.
#[account]
#[derive(InitSpace)]
pub struct RoomQueueEntry {
    pub player: Pubkey,
    pub tier_usd: u8,
    pub side: u8,
    pub sequence: u64,
    pub amount: u64,
    pub joined_slot: u64,
    pub status: EntryStatus,
    pub bump: u8,
}

/// A matched pair awaiting randomness and settlement.
#[account]
#[derive(InitSpace)]
pub struct Match {
    pub id: u64,
    pub heads_player: Pubkey,
    pub tails_player: Pubkey,
    pub heads_amount: u64,
    pub tails_amount: u64,
    pub total_pot: u64,
    pub tier_usd: u8,
    pub created_slot: u64,
    pub state: MatchState,
    /// Replay-resistant VRF seed, unique per match.
    pub seed: [u8; 32],
    pub result: Option<FlipResult>,
    pub winner: Option<Pubkey>,
    pub settled_slot: Option<u64>,
    pub bump: u8,
}
