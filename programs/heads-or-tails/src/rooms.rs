use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::errors::GameError;
use crate::events::*;
use crate::state::*;
use crate::vrf;
use crate::denomination;

// ---------------------------------------------------------------------------
// Tier-scoped rooms (V2): independent FIFO pools per real room.
// PDA: ["room", tier_byte]. Queue PDA:
// ["queue", tier_byte, side_byte, sequence_le]. Matching only pairs entries
// from the SAME tier. Global Match ID (config.total_matches) is preserved.
// Player one-active-global rule is preserved across ALL rooms.
// ---------------------------------------------------------------------------

pub fn room_pda(tier_usd: u8) -> Pubkey {
    Pubkey::find_program_address(&[b"room".as_ref(), &[tier_usd]], &crate::ID).0
}

pub fn room_queue_pda(tier_usd: u8, side: u8, sequence: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"queue".as_ref(),
            &[tier_usd],
            &[side],
            &sequence.to_le_bytes(),
        ],
        &crate::ID,
    )
    .0
}

fn room_next_for(room: &RoomState, side: u8) -> Result<u64> {
    match side {
        SIDE_HEADS => Ok(room.heads_next),
        SIDE_TAILS => Ok(room.tails_next),
        _ => err!(GameError::InvalidSide),
    }
}

#[derive(Accounts)]
#[instruction(tier_usd: u8)]
pub struct InitRoom<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(
        init,
        payer = admin,
        space = 8 + RoomState::INIT_SPACE,
        seeds = [&b"room"[..], &[tier_usd][..]],
        bump
    )]
    pub room: Account<'info, RoomState>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_room(ctx: Context<InitRoom>, tier_usd: u8, active: bool) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.authority,
        GameError::Unauthorized
    );
    require!(is_supported_tier(tier_usd), GameError::UnsupportedTier);
    let room = &mut ctx.accounts.room;
    room.tier_usd = tier_usd;
    room.active = active;
    room.heads_head = 0;
    room.heads_next = 0;
    room.tails_head = 0;
    room.tails_next = 0;
    room.bump = ctx.bumps.room;
    Ok(())
}

#[derive(Accounts)]
#[instruction(tier_usd: u8)]
pub struct AdminRoom<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [&b"room"[..], &[tier_usd][..]], bump)]
    pub room: Account<'info, RoomState>,
}

pub fn handle_set_room_active(
    ctx: Context<AdminRoom>,
    tier_usd: u8,
    active: bool,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.authority,
        GameError::Unauthorized
    );
    require!(is_supported_tier(tier_usd), GameError::UnsupportedTier);
    require!(
        ctx.accounts.room.tier_usd == tier_usd,
        GameError::InvalidHeadEntry
    );
    ctx.accounts.room.active = active;
    Ok(())
}

#[derive(Accounts)]
#[instruction(side: u8, tier_usd: u8, stake_amount: u64, sequence: u64)]
pub struct JoinQueueRoom<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [&b"room"[..], &[tier_usd][..]], bump)]
    pub room: Account<'info, RoomState>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [&b"player"[..], player.key().as_ref()],
        bump
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(
        init,
        payer = player,
        space = 8 + RoomQueueEntry::INIT_SPACE,
        seeds = [&b"queue"[..], &[tier_usd][..], &[side][..], &sequence.to_le_bytes()[..]],
        bump
    )]
    pub entry: Account<'info, RoomQueueEntry>,
    pub project_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(mut, token::mint = project_mint, token::authority = player)]
    pub player_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault"],
        bump,
        token::mint = project_mint,
    )]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: PDA authority of the vault; address verified by seeds.
    #[account(seeds = [b"vault-authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_join_queue_room(
    ctx: Context<JoinQueueRoom>,
    side: u8,
    tier_usd: u8,
    stake_amount: u64,
    sequence: u64,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, GameError::Paused);
    require!(
        side == SIDE_HEADS || side == SIDE_TAILS,
        GameError::InvalidSide
    );
    require!(is_supported_tier(tier_usd), GameError::UnsupportedTier);
    require!(
        ctx.accounts.room.tier_usd == tier_usd && ctx.accounts.room.active,
        GameError::TierInactive
    );
    denomination::validate_config_mint(ctx.accounts.config.project_mint)?;
    denomination::validate_mint(ctx.accounts.project_mint.key(), ctx.accounts.project_mint.decimals)?;
    denomination::validate_stake(tier_usd, stake_amount)?;
    require!(
        sequence == room_next_for(&ctx.accounts.room, side)?,
        GameError::InvalidHeadEntry
    );

    let state = &mut ctx.accounts.player_state;
    if state.player == Pubkey::default() {
        state.player = ctx.accounts.player.key();
        state.bump = ctx.bumps.player_state;
    }
    require_keys_eq!(state.player, ctx.accounts.player.key(), GameError::Unauthorized);
    require!(!state.queued && !state.in_match, GameError::AlreadyActive);

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::TransferChecked {
                from: ctx.accounts.player_tokens.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.player.to_account_info(),
                mint: ctx.accounts.project_mint.to_account_info(),
            },
        ),
        stake_amount,
        ctx.accounts.project_mint.decimals,
    )?;

    let slot = Clock::get()?.slot;
    let entry = &mut ctx.accounts.entry;
    entry.player = ctx.accounts.player.key();
    entry.tier_usd = tier_usd;
    entry.side = side;
    entry.sequence = sequence;
    entry.amount = stake_amount;
    entry.joined_slot = slot;
    entry.status = EntryStatus::Active;
    entry.bump = ctx.bumps.entry;

    state.queued = true;
    state.queued_side = side;
    state.queued_sequence = sequence;
    state.queued_tier_usd = tier_usd;
    if !state.in_match {
        state.match_tier_usd = 0;
    }

    match side {
        SIDE_HEADS => {
            ctx.accounts.room.heads_next = ctx
                .accounts
                .room
                .heads_next
                .checked_add(1)
                .ok_or(GameError::ArithmeticError)?;
        }
        _ => {
            ctx.accounts.room.tails_next = ctx
                .accounts
                .room
                .tails_next
                .checked_add(1)
                .ok_or(GameError::ArithmeticError)?;
        }
    }

    emit!(QueueJoined {
        player: ctx.accounts.player.key(),
        side,
        sequence,
        amount: stake_amount,
        tier_usd,
        matched: false,
        slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelQueueEntryRoom<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [b"player", player.key().as_ref()], bump)]
    pub player_state: Account<'info, PlayerState>,
    #[account(mut)]
    pub entry: Account<'info, RoomQueueEntry>,
    pub project_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(mut, token::mint = project_mint, token::authority = player)]
    pub player_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault"],
        bump,
        token::mint = project_mint,
    )]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: PDA authority of the vault; address verified by seeds.
    #[account(seeds = [b"vault-authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_cancel_queue_entry_room(ctx: Context<CancelQueueEntryRoom>) -> Result<()> {
    let state = &mut ctx.accounts.player_state;
    require_keys_eq!(state.player, ctx.accounts.player.key(), GameError::Unauthorized);
    require!(state.queued, GameError::NoActiveEntry);
    require!(!state.in_match, GameError::AlreadyMatched);

    let entry = &mut ctx.accounts.entry;
    require_keys_eq!(
        entry.key(),
        room_queue_pda(state.queued_tier_usd, state.queued_side, state.queued_sequence),
        GameError::StateEntryMismatch
    );
    require_keys_eq!(entry.player, ctx.accounts.player.key(), GameError::NotEntryOwner);
    require!(
        entry.status == EntryStatus::Active,
        if entry.status == EntryStatus::Matched {
            GameError::AlreadyMatched
        } else {
            GameError::EntryNotActive
        }
    );

    let amount = entry.amount;
    let seeds: &[&[u8]] = &[
        b"vault-authority",
        &[ctx.accounts.config.authority_bump],
    ];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.player_tokens.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
                mint: ctx.accounts.project_mint.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.project_mint.decimals,
    )?;

    entry.status = EntryStatus::Cancelled;
    state.queued = false;
    state.queued_tier_usd = 0;

    emit!(QueueCancelled {
        player: ctx.accounts.player.key(),
        side: entry.side,
        sequence: entry.sequence,
        amount,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(side: u8, tier_usd: u8)]
pub struct AdvanceHeadRoom<'info> {
    #[account(mut, seeds = [&b"room"[..], &[tier_usd][..]], bump)]
    pub room: Account<'info, RoomState>,
    /// CHECK: verified in handler against the current head of (tier, side).
    #[account(mut)]
    pub head_entry: UncheckedAccount<'info>,
}

pub fn handle_advance_head_room(
    ctx: Context<AdvanceHeadRoom>,
    side: u8,
    tier_usd: u8,
) -> Result<()> {
    require!(
        side == SIDE_HEADS || side == SIDE_TAILS,
        GameError::InvalidSide
    );
    require!(is_supported_tier(tier_usd), GameError::UnsupportedTier);
    require!(
        ctx.accounts.room.tier_usd == tier_usd,
        GameError::InvalidHeadEntry
    );
    let head_seq = if side == SIDE_HEADS {
        ctx.accounts.room.heads_head
    } else {
        ctx.accounts.room.tails_head
    };
    require_keys_eq!(
        ctx.accounts.head_entry.key(),
        room_queue_pda(tier_usd, side, head_seq),
        GameError::InvalidHeadEntry
    );
    let mut entry_data = ctx.accounts.head_entry.try_borrow_mut_data()?;
    let entry = RoomQueueEntry::try_deserialize(&mut &entry_data[..])
        .map_err(|_| GameError::HeadNotActive)?;
    require!(entry.side == side, GameError::HeadWrongSide);
    require!(entry.tier_usd == tier_usd, GameError::HeadWrongSide);
    require!(
        entry.status != EntryStatus::Active,
        GameError::HeadNotActive
    );
    if side == SIDE_HEADS {
        ctx.accounts.room.heads_head = head_seq
            .checked_add(1)
            .ok_or(GameError::ArithmeticError)?;
    } else {
        ctx.accounts.room.tails_head = head_seq
            .checked_add(1)
            .ok_or(GameError::ArithmeticError)?;
    }
    Ok(())
}

#[derive(Accounts)]
#[instruction(match_id: u64, tier_usd: u8)]
pub struct MatchNextRoom<'info> {
    /// Payer for the match account, the VRF request account and fees. Anyone.
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [&b"room"[..], &[tier_usd][..]], bump)]
    pub room: Account<'info, RoomState>,
    /// CHECK: verified in handler against the current tier heads head.
    #[account(mut)]
    pub head_heads: UncheckedAccount<'info>,
    /// CHECK: verified in handler against the current tier tails head.
    #[account(mut)]
    pub head_tails: UncheckedAccount<'info>,
    /// CHECK: heads player state; address verified in handler.
    #[account(mut)]
    pub heads_state: UncheckedAccount<'info>,
    /// CHECK: tails player state; address verified in handler.
    #[account(mut)]
    pub tails_state: UncheckedAccount<'info>,
    #[account(
        init,
        payer = caller,
        space = 8 + Match::INIT_SPACE,
        seeds = [&b"match"[..], &match_id.to_le_bytes()[..]],
        bump
    )]
    pub game_match: Account<'info, Match>,
    /// CHECK: ORAO VRF program; key verified in handler.
    pub vrf_program: UncheckedAccount<'info>,
    /// CHECK: ORAO network state PDA; key verified in handler.
    #[account(mut)]
    pub vrf_network_state: UncheckedAccount<'info>,
    /// CHECK: ORAO treasury; validated by the VRF program during CPI.
    #[account(mut)]
    pub vrf_treasury: UncheckedAccount<'info>,
    /// CHECK: randomness PDA for this match seed; created by the VRF program.
    #[account(mut)]
    pub randomness: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_match_next_room(
    ctx: Context<MatchNextRoom>,
    match_id: u64,
    tier_usd: u8,
    nonce: [u8; 32],
) -> Result<()> {
    require!(!ctx.accounts.config.paused, GameError::Paused);
    denomination::validate_config_mint(ctx.accounts.config.project_mint)?;
    let seed = vrf::match_seed(match_id, &nonce)?;
    require!(is_supported_tier(tier_usd), GameError::UnsupportedTier);
    require!(
        ctx.accounts.room.tier_usd == tier_usd && ctx.accounts.room.active,
        GameError::TierInactive
    );
    require!(
        match_id == ctx.accounts.config.total_matches,
        GameError::InvalidHeadEntry
    );

    let heads_seq = ctx.accounts.room.heads_head;
    require_keys_eq!(
        ctx.accounts.head_heads.key(),
        room_queue_pda(tier_usd, SIDE_HEADS, heads_seq),
        GameError::InvalidHeadEntry
    );
    let mut heads_entry_data = ctx.accounts.head_heads.try_borrow_mut_data()?;
    let mut heads_entry =
        RoomQueueEntry::try_deserialize(&mut &heads_entry_data[..])
            .map_err(|_| GameError::HeadNotActive)?;
    require!(
        heads_entry.status == EntryStatus::Active,
        GameError::HeadNotActive
    );
    require!(heads_entry.side == SIDE_HEADS, GameError::HeadWrongSide);
    require!(heads_entry.tier_usd == tier_usd, GameError::HeadWrongSide);

    let tails_seq = ctx.accounts.room.tails_head;
    require_keys_eq!(
        ctx.accounts.head_tails.key(),
        room_queue_pda(tier_usd, SIDE_TAILS, tails_seq),
        GameError::InvalidHeadEntry
    );
    let mut tails_entry_data = ctx.accounts.head_tails.try_borrow_mut_data()?;
    let mut tails_entry =
        RoomQueueEntry::try_deserialize(&mut &tails_entry_data[..])
            .map_err(|_| GameError::HeadNotActive)?;
    require!(
        tails_entry.status == EntryStatus::Active,
        GameError::HeadNotActive
    );
    require!(tails_entry.side == SIDE_TAILS, GameError::HeadWrongSide);
    require!(tails_entry.tier_usd == tier_usd, GameError::HeadWrongSide);
    denomination::validate_stake(tier_usd, heads_entry.amount)?;
    denomination::validate_stake(tier_usd, tails_entry.amount)?;

    require!(
        heads_entry.player != tails_entry.player,
        GameError::SelfMatch
    );

    let mut heads_state_data = ctx.accounts.heads_state.try_borrow_mut_data()?;
    let mut heads_state =
        PlayerState::try_deserialize(&mut &heads_state_data[..])
            .map_err(|_| GameError::AlreadyActive)?;
    require_keys_eq!(
        ctx.accounts.heads_state.key(),
        Pubkey::find_program_address(
            &[b"player", heads_entry.player.as_ref()],
            &crate::ID
        )
        .0,
        GameError::InvalidHeadEntry
    );
    require!(
        heads_state.queued
            && heads_state.queued_side == SIDE_HEADS
            && heads_state.queued_sequence == heads_seq
            && heads_state.queued_tier_usd == tier_usd,
        GameError::EntryNotActive
    );

    let mut tails_state_data = ctx.accounts.tails_state.try_borrow_mut_data()?;
    let mut tails_state =
        PlayerState::try_deserialize(&mut &tails_state_data[..])
            .map_err(|_| GameError::AlreadyActive)?;
    require_keys_eq!(
        ctx.accounts.tails_state.key(),
        Pubkey::find_program_address(
            &[b"player", tails_entry.player.as_ref()],
            &crate::ID
        )
        .0,
        GameError::InvalidHeadEntry
    );
    require!(
        tails_state.queued
            && tails_state.queued_side == SIDE_TAILS
            && tails_state.queued_sequence == tails_seq
            && tails_state.queued_tier_usd == tier_usd,
        GameError::EntryNotActive
    );

    heads_entry.status = EntryStatus::Matched;
    tails_entry.status = EntryStatus::Matched;
    heads_entry
        .try_serialize(&mut &mut heads_entry_data[..])
        .map_err(|_| GameError::ArithmeticError)?;
    tails_entry
        .try_serialize(&mut &mut tails_entry_data[..])
        .map_err(|_| GameError::ArithmeticError)?;

    heads_state.queued = false;
    heads_state.queued_tier_usd = 0;
    heads_state.in_match = true;
    heads_state.match_id = match_id;
    heads_state.match_tier_usd = tier_usd;
    tails_state.queued = false;
    tails_state.queued_tier_usd = 0;
    tails_state.in_match = true;
    tails_state.match_id = match_id;
    tails_state.match_tier_usd = tier_usd;
    heads_state
        .try_serialize(&mut &mut heads_state_data[..])
        .map_err(|_| GameError::ArithmeticError)?;
    tails_state
        .try_serialize(&mut &mut tails_state_data[..])
        .map_err(|_| GameError::ArithmeticError)?;

    ctx.accounts.room.heads_head = heads_seq
        .checked_add(1)
        .ok_or(GameError::ArithmeticError)?;
    ctx.accounts.room.tails_head = tails_seq
        .checked_add(1)
        .ok_or(GameError::ArithmeticError)?;

    let total_pot = heads_entry
        .amount
        .checked_add(tails_entry.amount)
        .ok_or(GameError::ArithmeticError)?;
    let slot = Clock::get()?.slot;

    let game_match = &mut ctx.accounts.game_match;
    game_match.id = match_id;
    game_match.heads_player = heads_entry.player;
    game_match.tails_player = tails_entry.player;
    game_match.heads_amount = heads_entry.amount;
    game_match.tails_amount = tails_entry.amount;
    game_match.total_pot = total_pot;
    game_match.tier_usd = tier_usd;
    game_match.created_slot = slot;
    game_match.state = MatchState::WaitingForRandomness;
    game_match.seed = seed;
    game_match.result = None;
    game_match.winner = None;
    game_match.settled_slot = None;
    game_match.bump = ctx.bumps.game_match;

    require_keys_eq!(
        ctx.accounts.vrf_program.key(),
        vrf::ORAO_VRF_PROGRAM_ID,
        GameError::WrongVrfOwner
    );
    require_keys_eq!(
        ctx.accounts.vrf_network_state.key(),
        orao_solana_vrf::network_state_account_address(&vrf::ORAO_VRF_PROGRAM_ID),
        GameError::WrongVrfOwner
    );
    require_keys_eq!(
        ctx.accounts.randomness.key(),
        vrf::randomness_address(&seed),
        GameError::WrongRandomnessAccount
    );
    let cpi_accounts = orao_solana_vrf::cpi::accounts::RequestV2 {
        payer: ctx.accounts.caller.to_account_info(),
        network_state: ctx.accounts.vrf_network_state.to_account_info(),
        treasury: ctx.accounts.vrf_treasury.to_account_info(),
        request: ctx.accounts.randomness.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };
    orao_solana_vrf::cpi::request_v2(
        CpiContext::new(
            ctx.accounts.vrf_program.to_account_info(),
            cpi_accounts,
        ),
        seed,
    )?;

    ctx.accounts.config.total_matches = match_id
        .checked_add(1)
        .ok_or(GameError::ArithmeticError)?;

    emit!(MatchCreated {
        match_id,
        heads_player: game_match.heads_player,
        tails_player: game_match.tails_player,
        heads_amount: game_match.heads_amount,
        tails_amount: game_match.tails_amount,
        total_pot,
        tier_usd,
        seed,
        slot,
    });
    Ok(())
}

/// Permissionless migration for pre-V2 PlayerState accounts.
/// The legacy 60-byte V1 layout CANNOT be loaded through
/// `Account<PlayerState>` (Anchor deserializes before realloc and fails with
/// AccountDidNotDeserialize), so this instruction validates the raw account
/// manually: program ownership, exact PDA, discriminator, exact length
/// (60 = V1, 62 = already-migrated V2), then expands V1 in place while
/// preserving every legacy field. Malformed accounts fail closed.
#[derive(Accounts)]
pub struct MigratePlayerState<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: validated manually in the handler (see above).
    #[account(mut)]
    pub player_state: UncheckedAccount<'info>,
    /// CHECK: owner of the player state; bound to the PDA and to the stored
    /// player field inside the handler.
    pub player_owner: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Exact on-chain sizes: 8-byte discriminator + 52-byte V1 body.
const PLAYER_STATE_V1_LEN: usize = 8 + 52;
/// 8-byte discriminator + 54-byte V2 body.
const PLAYER_STATE_V2_LEN: usize = 8 + PlayerState::INIT_SPACE;

pub fn handle_migrate_player_state(ctx: Context<MigratePlayerState>) -> Result<()> {
    use anchor_lang::Discriminator;

    let state_key = ctx.accounts.player_state.key();
    let owner_key = ctx.accounts.player_owner.key();

    // 1. Program ownership.
    require!(
        ctx.accounts.player_state.owner == &crate::ID,
        GameError::Unauthorized
    );
    // 2. Exact PDA binding.
    let (expected_pda, _) = Pubkey::find_program_address(
        &[b"player", owner_key.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(state_key, expected_pda, GameError::Unauthorized);

    // 3 + 4. Discriminator and exact allowed length.
    let data = ctx.accounts.player_state.try_borrow_data()?;
    require!(
        data.len() == PLAYER_STATE_V1_LEN || data.len() == PLAYER_STATE_V2_LEN,
        GameError::PlayerStateDataInvalid
    );
    require!(
        data[0..8] == PlayerState::DISCRIMINATOR[..],
        GameError::PlayerStateDataInvalid
    );

    // 5. Manual V1-prefix decode with strict scalar validation (Borsh
    // bools accept only 0/1; sides are 0/1 by program construction).
    let player = Pubkey::new_from_array(
        data[8..40]
            .try_into()
            .map_err(|_| GameError::PlayerStateDataInvalid)?,
    );
    require_keys_eq!(player, owner_key, GameError::Unauthorized);
    require!(
        data[40] <= 1 && data[41] <= 1 && data[50] <= 1,
        GameError::PlayerStateDataInvalid
    );
    let queued = data[40] == 1;
    let queued_side = data[41];
    let queued_sequence = u64::from_le_bytes(
        data[42..50]
            .try_into()
            .map_err(|_| GameError::PlayerStateDataInvalid)?,
    );
    let in_match = data[50] == 1;
    let match_id = u64::from_le_bytes(
        data[51..59]
            .try_into()
            .map_err(|_| GameError::PlayerStateDataInvalid)?,
    );
    let bump = data[59];

    // Idempotent path: already-V2 accounts are verified above and returned
    // untouched (tier fields never reset).
    if data.len() == PLAYER_STATE_V2_LEN {
        return Ok(());
    }
    drop(data);

    // Pre-V2 only $1 existed: active legacy positions default to $1, idle
    // positions keep tier context 0.
    let queued_tier_usd = if queued { TIER_1_USD } else { 0 };
    let match_tier_usd = if in_match { TIER_1_USD } else { 0 };

    // Fund the rent delta for the 2-byte expansion from the payer.
    let rent = Rent::get()?;
    let required = rent.minimum_balance(PLAYER_STATE_V2_LEN);
    let current = ctx.accounts.player_state.lamports();
    if required > current {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.player_state.to_account_info(),
                },
            ),
            required - current,
        )?;
    }

    // Expand in place, preserving all 60 legacy bytes.
    ctx.accounts
        .player_state
        .realloc(PLAYER_STATE_V2_LEN, false)?;

    let migrated = PlayerState {
        player,
        queued,
        queued_side,
        queued_sequence,
        in_match,
        match_id,
        bump,
        queued_tier_usd,
        match_tier_usd,
    };
    let mut account_data = ctx.accounts.player_state.try_borrow_mut_data()?;
    // Anchor's AccountSerialize writes the 8-byte discriminator followed by
    // the struct, so serialize over the whole account (disc slot already
    // verified; the write reproduces the identical bytes).
    let mut writer = &mut account_data[..];
    migrated
        .try_serialize(&mut writer)
        .map_err(|_| GameError::PlayerStateDataInvalid)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_and_ten_supported() {
        assert!(is_supported_tier(TIER_1_USD));
        assert!(is_supported_tier(TIER_10_USD));
        assert!(!is_supported_tier(TIER_100_USD));
        assert!(!is_supported_tier(2));
        assert!(!is_supported_tier(0));
    }

    #[test]
    fn room_pdas_are_tier_scoped() {
        assert_ne!(room_pda(TIER_1_USD), room_pda(TIER_10_USD));
        assert_eq!(room_pda(TIER_1_USD), room_pda(TIER_1_USD));
    }

    #[test]
    fn queue_pdas_never_cross_tiers_or_sides() {
        let a = room_queue_pda(TIER_1_USD, SIDE_HEADS, 7);
        assert_eq!(a, room_queue_pda(TIER_1_USD, SIDE_HEADS, 7));
        assert_ne!(a, room_queue_pda(TIER_10_USD, SIDE_HEADS, 7));
        assert_ne!(a, room_queue_pda(TIER_1_USD, SIDE_TAILS, 7));
        assert_ne!(a, room_queue_pda(TIER_1_USD, SIDE_HEADS, 8));
        // Tier-scoped V2 PDAs never collide with legacy V1 queue PDAs,
        // so the $1 legacy pool drains safely while rooms go live.
        let legacy_heads_7 = Pubkey::find_program_address(
            &[b"queue", &[SIDE_HEADS], &7u64.to_le_bytes()],
            &crate::ID,
        )
        .0;
        assert_ne!(a, legacy_heads_7);
        assert_ne!(
            room_queue_pda(TIER_10_USD, SIDE_TAILS, 7),
            Pubkey::find_program_address(
                &[b"queue", &[SIDE_TAILS], &7u64.to_le_bytes()],
                &crate::ID,
            )
            .0
        );
    }

    #[test]
    fn room_state_layout_is_tier_scoped() {
        // RoomState carries independent FIFO pointers per tier.
        assert_eq!(RoomState::INIT_SPACE, 1 + 1 + 8 + 8 + 8 + 8 + 1);
    }
}

