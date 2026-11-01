// HTS namespace only. Historical room handlers remain in rooms.rs.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::errors::GameError;
use crate::events::*;
use crate::state::*;
use crate::vrf;
use crate::denomination;
use crate::hts::{validate_bound_mint, require_legacy_idle};

// ---------------------------------------------------------------------------
// Tier-scoped rooms (V2): independent FIFO pools per real room.
// PDA: ["room", tier_byte]. Queue PDA:
// ["queue", tier_byte, side_byte, sequence_le]. Matching only pairs entries
// from the SAME tier. Global Match ID (config.total_matches) is preserved.
// Player one-active-global rule is preserved across ALL rooms.
// ---------------------------------------------------------------------------

pub fn hts_room_pda(tier_usd: u8) -> Pubkey {
    Pubkey::find_program_address(&[b"hts-room".as_ref(), &[tier_usd]], &crate::ID).0
}

pub fn hts_room_queue_pda(tier_usd: u8, side: u8, sequence: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"hts-queue".as_ref(),
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
pub struct HtsInitRoom<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"hts-config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(
        init,
        payer = admin,
        space = 8 + RoomState::INIT_SPACE,
        seeds = [&b"hts-room"[..], &[tier_usd][..]],
        bump
    )]
    pub room: Account<'info, RoomState>,
    pub system_program: Program<'info, System>,
}

pub fn handle_hts_init_room(ctx: Context<HtsInitRoom>, tier_usd: u8, active: bool) -> Result<()> {
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
pub struct HtsAdminRoom<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"hts-config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [&b"hts-room"[..], &[tier_usd][..]], bump)]
    pub room: Account<'info, RoomState>,
}

pub fn handle_hts_set_room_active(
    ctx: Context<HtsAdminRoom>,
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
pub struct HtsJoinQueueRoom<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"hts-config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(seeds = [b"config"], bump, constraint = legacy_config.paused @ GameError::LegacyIntakeMustBePaused)]
    pub legacy_config: Account<'info, GameConfig>,
    /// CHECK: canonical legacy PDA; validated as absent or strictly decoded, read-only.
    #[account(seeds = [b"player", player.key().as_ref()], bump)]
    pub legacy_player_state: UncheckedAccount<'info>,
    #[account(mut, seeds = [&b"hts-room"[..], &[tier_usd][..]], bump)]
    pub room: Account<'info, RoomState>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [&b"hts-player"[..], player.key().as_ref()],
        bump
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(
        init,
        payer = player,
        space = 8 + RoomQueueEntry::INIT_SPACE,
        seeds = [&b"hts-queue"[..], &[tier_usd][..], &[side][..], &sequence.to_le_bytes()[..]],
        bump
    )]
    pub entry: Account<'info, RoomQueueEntry>,
    pub project_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(mut, token::mint = project_mint, token::authority = player)]
    pub player_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"hts-vault"],
        bump,
        token::mint = project_mint,
    )]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: PDA authority of the vault; address verified by seeds.
    #[account(seeds = [b"hts-vault-authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_hts_join_queue_room(
    ctx: Context<HtsJoinQueueRoom>,
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
    validate_bound_mint(&ctx.accounts.config, ctx.accounts.project_mint.key(), ctx.accounts.project_mint.decimals)?;
    denomination::validate_hts_usd_stake(tier_usd, stake_amount)?;
    require!(
        sequence == room_next_for(&ctx.accounts.room, side)?,
        GameError::InvalidHeadEntry
    );

    require_legacy_idle(&ctx.accounts.legacy_player_state, ctx.accounts.player.key())?;
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
pub struct HtsCancelQueueEntryRoom<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"hts-config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [b"hts-player", player.key().as_ref()], bump)]
    pub player_state: Account<'info, PlayerState>,
    #[account(mut)]
    pub entry: Account<'info, RoomQueueEntry>,
    pub project_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(mut, token::mint = project_mint, token::authority = player)]
    pub player_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"hts-vault"],
        bump,
        token::mint = project_mint,
    )]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: PDA authority of the vault; address verified by seeds.
    #[account(seeds = [b"hts-vault-authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_hts_cancel_queue_entry_room(ctx: Context<HtsCancelQueueEntryRoom>) -> Result<()> {
    validate_bound_mint(&ctx.accounts.config, ctx.accounts.project_mint.key(), ctx.accounts.project_mint.decimals)?;
    let state = &mut ctx.accounts.player_state;
    require_keys_eq!(state.player, ctx.accounts.player.key(), GameError::Unauthorized);
    require!(state.queued, GameError::NoActiveEntry);
    require!(!state.in_match, GameError::AlreadyMatched);

    let entry = &mut ctx.accounts.entry;
    require_keys_eq!(
        entry.key(),
        hts_room_queue_pda(state.queued_tier_usd, state.queued_side, state.queued_sequence),
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
        b"hts-vault-authority",
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
pub struct HtsAdvanceHeadRoom<'info> {
    #[account(mut, seeds = [&b"hts-room"[..], &[tier_usd][..]], bump)]
    pub room: Account<'info, RoomState>,
    /// CHECK: verified in handler against the current head of (tier, side).
    #[account(mut)]
    pub head_entry: UncheckedAccount<'info>,
}

pub fn handle_hts_advance_head_room(
    ctx: Context<HtsAdvanceHeadRoom>,
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
        hts_room_queue_pda(tier_usd, side, head_seq),
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
pub struct HtsMatchNextRoom<'info> {
    /// Payer for the match account, the VRF request account and fees. Anyone.
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"hts-config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [b"config"], bump, constraint = legacy_config.paused @ GameError::LegacyIntakeMustBePaused)]
    pub legacy_config: Account<'info, GameConfig>,
    #[account(mut, seeds = [&b"hts-room"[..], &[tier_usd][..]], bump)]
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
        seeds = [&b"hts-match"[..], &match_id.to_le_bytes()[..]],
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

pub fn handle_hts_match_next_room(
    ctx: Context<HtsMatchNextRoom>,
    match_id: u64,
    tier_usd: u8,
    nonce: [u8; 32],
) -> Result<()> {
    require!(!ctx.accounts.config.paused, GameError::Paused);
    let seed = vrf::match_seed(match_id, &nonce)?;
    require!(is_supported_tier(tier_usd), GameError::UnsupportedTier);
    require!(
        ctx.accounts.room.tier_usd == tier_usd && ctx.accounts.room.active,
        GameError::TierInactive
    );
    require!(
        match_id == ctx.accounts.legacy_config.total_matches,
        GameError::InvalidHeadEntry
    );

    let heads_seq = ctx.accounts.room.heads_head;
    require_keys_eq!(
        ctx.accounts.head_heads.key(),
        hts_room_queue_pda(tier_usd, SIDE_HEADS, heads_seq),
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
        hts_room_queue_pda(tier_usd, SIDE_TAILS, tails_seq),
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
    denomination::validate_hts_usd_stake(tier_usd, heads_entry.amount)?;
    denomination::validate_hts_usd_stake(tier_usd, tails_entry.amount)?;

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
            &[b"hts-player", heads_entry.player.as_ref()],
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
            &[b"hts-player", tails_entry.player.as_ref()],
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

    ctx.accounts.legacy_config.total_matches = ctx.accounts.config.total_matches;

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

