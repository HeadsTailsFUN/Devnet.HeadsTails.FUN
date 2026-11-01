use anchor_lang::prelude::*;

mod authority;
mod hts;
mod hts_rooms;
mod hts_settlement;
mod denomination;
mod errors;
mod events;
mod instructions;
mod rooms;
mod state;
mod vrf;

use authority::*;
use hts::*;
use hts_rooms::*;
use hts_settlement::*;
use instructions::*;
use rooms::*;

declare_id!("AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k");

#[program]
pub mod heads_or_tails {
    use super::*;

    /// Create the game config and the program-controlled token vault.
    pub fn initialize(ctx: Context<Initialize>, tier1_active: bool) -> Result<()> {
        handle_initialize(ctx, tier1_active)
    }

    /// Pause or unpause new queue joins. Admin only.
    pub fn set_paused(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
        handle_set_paused(ctx, paused)
    }

    /// Enable or disable a tier. Only tier 1 exists in V1. Admin only.
    pub fn set_tier_active(ctx: Context<AdminConfig>, tier_usd: u8, active: bool) -> Result<()> {
        handle_set_tier_active(ctx, tier_usd, active)
    }

    /// Normal owner transfer. The CURRENT owner signs. Prefer a two-step
    /// propose/accept upgrade later; this keeps the account layout unchanged.
    pub fn set_authority(ctx: Context<AdminConfig>, new_authority: Pubkey) -> Result<()> {
        handle_set_authority(ctx, new_authority)
    }

    /// Stake the exact token amount and enqueue it on `side`.
    /// `sequence` must equal the current tail of that side (read from
    /// GameConfig); pass it explicitly so the entry PDA is deterministic.
    pub fn join_queue(
        ctx: Context<JoinQueue>,
        side: u8,
        tier_usd: u8,
        stake_amount: u64,
        sequence: u64,
    ) -> Result<()> {
        handle_join_queue(ctx, side, tier_usd, stake_amount, sequence)
    }

    /// Permissionless FIFO matcher. Matches the two current queue heads and
    /// requests ORAO VRF exactly once. `match_id` must equal
    /// `config.total_matches`. Supply a fresh unpredictable nonce for each
    /// new attempt; an existing ORAO request is never adopted.
    pub fn match_next(ctx: Context<MatchNext>, match_id: u64, nonce: [u8; 32]) -> Result<()> {
        handle_match_next(ctx, match_id, nonce)
    }

    /// Permissionless hole skipping. Advances one queue head past a
    /// provably inactive entry. Moves no funds.
    pub fn advance_head(ctx: Context<AdvanceHead>, side: u8) -> Result<()> {
        handle_advance_head(ctx, side)
    }

    /// Refund an unmatched entry exactly and free the wallet for re-entry.
    pub fn cancel_queue_entry(ctx: Context<CancelQueueEntry>) -> Result<()> {
        handle_cancel_queue_entry(ctx)
    }

    /// Permissionless settlement. Anyone may call it (winner, loser, keeper);
    /// the program alone derives the result, the winner, the destination and
    /// the amount from verified on-chain state.
    pub fn settle_match(ctx: Context<SettleMatch>, match_id: u64) -> Result<()> {
        handle_settle_match(ctx, match_id)
    }

    /// V2: create a tier-scoped room. Admin only. Supported: $1, $10.
    pub fn init_room(ctx: Context<InitRoom>, tier_usd: u8, active: bool) -> Result<()> {
        handle_init_room(ctx, tier_usd, active)
    }

    /// V2: enable/disable a tier-scoped room. Admin only.
    pub fn set_room_active(
        ctx: Context<AdminRoom>,
        tier_usd: u8,
        active: bool,
    ) -> Result<()> {
        handle_set_room_active(ctx, tier_usd, active)
    }

    /// V2: stake into a tier-scoped room queue. `sequence` must equal the
    /// room's current tail for `side`. Global one-active rule preserved.
    pub fn join_queue_room(
        ctx: Context<JoinQueueRoom>,
        side: u8,
        tier_usd: u8,
        stake_amount: u64,
        sequence: u64,
    ) -> Result<()> {
        handle_join_queue_room(ctx, side, tier_usd, stake_amount, sequence)
    }

    /// V2: permissionless FIFO matcher within ONE tier/room. `match_id` must
    /// equal global `config.total_matches`. Supply a fresh unpredictable nonce.
    pub fn match_next_room(
        ctx: Context<MatchNextRoom>,
        match_id: u64,
        tier_usd: u8,
        nonce: [u8; 32],
    ) -> Result<()> {
        handle_match_next_room(ctx, match_id, tier_usd, nonce)
    }

    /// V2: permissionless hole skipping within ONE tier/room.
    pub fn advance_head_room(
        ctx: Context<AdvanceHeadRoom>,
        side: u8,
        tier_usd: u8,
    ) -> Result<()> {
        handle_advance_head_room(ctx, side, tier_usd)
    }

    /// V2: refund an unmatched tier-scoped entry exactly.
    pub fn cancel_queue_entry_room(ctx: Context<CancelQueueEntryRoom>) -> Result<()> {
        handle_cancel_queue_entry_room(ctx)
    }

    /// Owner-authorized isolated HTS namespace; legacy config must already be paused.
    pub fn initialize_hts(ctx: Context<InitializeHts>) -> Result<()> { handle_initialize_hts(ctx) }
    pub fn set_hts_paused(ctx: Context<HtsAdminConfig>, paused: bool) -> Result<()> { handle_set_hts_paused(ctx, paused) }
    pub fn init_hts_room(ctx: Context<HtsInitRoom>, tier_usd: u8, active: bool) -> Result<()> { handle_hts_init_room(ctx, tier_usd, active) }
    pub fn set_hts_room_active(ctx: Context<HtsAdminRoom>, tier_usd: u8, active: bool) -> Result<()> { handle_hts_set_room_active(ctx, tier_usd, active) }
    pub fn join_hts_queue_room(ctx: Context<HtsJoinQueueRoom>, side: u8, tier_usd: u8, stake_amount: u64, sequence: u64) -> Result<()> { handle_hts_join_queue_room(ctx, side, tier_usd, stake_amount, sequence) }
    pub fn match_next_hts_room(ctx: Context<HtsMatchNextRoom>, match_id: u64, tier_usd: u8, nonce: [u8;32]) -> Result<()> { handle_hts_match_next_room(ctx, match_id, tier_usd, nonce) }
    pub fn advance_hts_head_room(ctx: Context<HtsAdvanceHeadRoom>, side: u8, tier_usd: u8) -> Result<()> { handle_hts_advance_head_room(ctx, side, tier_usd) }
    pub fn cancel_hts_queue_entry_room(ctx: Context<HtsCancelQueueEntryRoom>) -> Result<()> { handle_hts_cancel_queue_entry_room(ctx) }
    pub fn settle_hts_match(ctx: Context<HtsSettleMatch>, match_id: u64) -> Result<()> { handle_hts_settle_match(ctx, match_id) }

    /// V2 migration: expand a pre-V2 PlayerState to the tier-aware layout.
    /// Idle-only is trivially safe; active legacy positions default to $1
    /// (the only room that existed pre-V2). Settled history is untouched.
    pub fn migrate_player_state(ctx: Context<MigratePlayerState>) -> Result<()> {
        handle_migrate_player_state(ctx)
    }
}

#[cfg(test)]
mod b3_abi_tests {
    use super::*;
    use anchor_lang::InstructionData;

    #[test]
    fn both_match_abis_require_the_full_nonce() {
        let legacy = crate::instruction::MatchNext { match_id: 42, nonce: [1;32] }.data();
        let room = crate::instruction::MatchNextRoom { match_id: 42, tier_usd: 10, nonce: [1;32] }.data();
        assert_eq!(legacy.len(), 48);
        assert_eq!(room.len(), 49);
        assert_eq!(&legacy[..8], &[54,2,209,0,163,10,31,225]);
        assert_eq!(&room[..8], &[94,29,117,196,66,144,245,94]);
        assert!(crate::instruction::MatchNext::deserialize(&mut &legacy[8..16]).is_err());
        assert!(crate::instruction::MatchNextRoom::deserialize(&mut &room[8..17]).is_err());
        assert_eq!(crate::instruction::MatchNext::deserialize(&mut &legacy[8..]).unwrap().nonce, [1;32]);
        assert_eq!(crate::instruction::MatchNextRoom::deserialize(&mut &room[8..]).unwrap().nonce, [1;32]);
    }
}
