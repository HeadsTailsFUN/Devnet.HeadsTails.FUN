use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::errors::GameError;
use crate::events::*;
use crate::state::*;
use crate::vrf;
use crate::denomination;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn next_for(config: &GameConfig, side: u8) -> Result<u64> {
    match side {
        SIDE_HEADS => Ok(config.heads_next),
        SIDE_TAILS => Ok(config.tails_next),
        _ => err!(GameError::InvalidSide),
    }
}

fn queue_pda(side: u8, sequence: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"queue", &[side], &sequence.to_le_bytes()],
        &crate::ID,
    )
    .0
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub project_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(
        init,
        payer = admin,
        space = 8 + GameConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, GameConfig>,
    /// CHECK: PDA authority of the vault; address verified by seeds.
    #[account(seeds = [b"vault-authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        seeds = [b"vault"],
        bump,
        token::mint = project_mint,
        token::authority = vault_authority
    )]
    pub vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_initialize(ctx: Context<Initialize>, tier1_active: bool) -> Result<()> {
    denomination::validate_mint(ctx.accounts.project_mint.key(), ctx.accounts.project_mint.decimals)?;
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.admin.key();
    config.project_mint = ctx.accounts.project_mint.key();
    config.paused = false;
    config.tier1_active = tier1_active;
    config.heads_head = 0;
    config.heads_next = 0;
    config.tails_head = 0;
    config.tails_next = 0;
    config.total_matches = 0;
    config.vault_bump = ctx.bumps.vault;
    config.authority_bump = ctx.bumps.vault_authority;
    config.config_bump = ctx.bumps.config;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, GameConfig>,
}

pub fn handle_set_paused(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.authority,
        GameError::Unauthorized
    );
    ctx.accounts.config.paused = paused;
    Ok(())
}

pub fn handle_set_tier_active(
    ctx: Context<AdminConfig>,
    tier_usd: u8,
    active: bool,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.authority,
        GameError::Unauthorized
    );
    require!(tier_usd == TIER_1_USD, GameError::UnsupportedTier);
    ctx.accounts.config.tier1_active = active;
    Ok(())
}

// ---------------------------------------------------------------------------
// Join: enqueue a stake. Matching happens in `match_next` so the joiner (or
// any cranker) can compose [join_queue, match_next] in one transaction for
// an immediate match.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(side: u8, tier_usd: u8, stake_amount: u64, sequence: u64)]
pub struct JoinQueue<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, GameConfig>,
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
        space = 8 + QueueEntry::INIT_SPACE,
        seeds = [&b"queue"[..], &[side][..], &sequence.to_le_bytes()[..]],
        bump
    )]
    pub entry: Account<'info, QueueEntry>,
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

pub fn handle_join_queue(
    ctx: Context<JoinQueue>,
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
    require!(tier_usd == TIER_1_USD, GameError::UnsupportedTier);
    require!(
        tier_usd == TIER_1_USD && ctx.accounts.config.tier1_active,
        GameError::TierInactive
    );
    denomination::validate_config_mint(ctx.accounts.config.project_mint)?;
    denomination::validate_mint(ctx.accounts.project_mint.key(), ctx.accounts.project_mint.decimals)?;
    denomination::validate_stake(tier_usd, stake_amount)?;
    // Anchor also binds both token accounts to this validated SPL mint.
    // Sequence must be the current tail of the chosen side: callers cannot
    // pick arbitrary slots, so FIFO order is enforced.
    require!(
        sequence == next_for(&ctx.accounts.config, side)?,
        GameError::InvalidHeadEntry
    );

    let state = &mut ctx.accounts.player_state;
    if state.player == Pubkey::default() {
        state.player = ctx.accounts.player.key();
        state.bump = ctx.bumps.player_state;
    }
    require_keys_eq!(state.player, ctx.accounts.player.key(), GameError::Unauthorized);
    require!(!state.queued && !state.in_match, GameError::AlreadyActive);

    // Escrow the exact stake into the program-controlled vault.
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
    // Joining clears any stale match-tier context (global one-active rule).
    if !state.in_match {
        state.match_tier_usd = 0;
    }

    match side {
        SIDE_HEADS => {
            ctx.accounts.config.heads_next =
                ctx.accounts.config.heads_next.checked_add(1).ok_or(GameError::ArithmeticError)?;
        }
        _ => {
            ctx.accounts.config.tails_next =
                ctx.accounts.config.tails_next.checked_add(1).ok_or(GameError::ArithmeticError)?;
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

// ---------------------------------------------------------------------------
// Cancel: refund an unmatched entry exactly. Matched entries cannot cancel;
// the match/settle race resolves through on-chain status checks.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CancelQueueEntry<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [b"player", player.key().as_ref()], bump)]
    pub player_state: Account<'info, PlayerState>,
    #[account(mut)]
    pub entry: Account<'info, QueueEntry>,
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

pub fn handle_cancel_queue_entry(ctx: Context<CancelQueueEntry>) -> Result<()> {
    let state = &mut ctx.accounts.player_state;
    require_keys_eq!(state.player, ctx.accounts.player.key(), GameError::Unauthorized);
    require!(state.queued, GameError::NoActiveEntry);
    require!(!state.in_match, GameError::AlreadyMatched);

    let entry = &mut ctx.accounts.entry;
    require_keys_eq!(
        entry.key(),
        queue_pda(state.queued_side, state.queued_sequence),
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
    // Note: token-mint enforcement happens through Anchor's token::mint
    // constraints on player_tokens/vault (see context structs).

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

// ---------------------------------------------------------------------------
// Match: permissionless FIFO matcher. Matches the two current heads and
// requests ORAO VRF exactly once. Holes are skipped separately via
// `advance_head`. Competing transactions race safely: only one can flip
// both heads to Matched, the other fails validation.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct MatchNext<'info> {
    /// Payer for the match account, the VRF request account and fees. Anyone.
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, GameConfig>,
    /// CHECK: verified in handler against the current heads head.
    #[account(mut)]
    pub head_heads: UncheckedAccount<'info>,
    /// CHECK: verified in handler against the current tails head.
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
    /// CHECK: ORAO network state PDA; key verified in handler. Mutable:
    /// the VRF program bumps its request counter on each request.
    #[account(mut)]
    pub vrf_network_state: UncheckedAccount<'info>,
    /// CHECK: ORAO treasury; validated by the VRF program during CPI.
    /// Mutable: it receives the request fee.
    #[account(mut)]
    pub vrf_treasury: UncheckedAccount<'info>,
    /// CHECK: randomness PDA for this match seed; created by the VRF program.
    #[account(mut)]
    pub randomness: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_match_next(ctx: Context<MatchNext>, match_id: u64, nonce: [u8; 32]) -> Result<()> {
    require!(!ctx.accounts.config.paused, GameError::Paused);
    denomination::validate_config_mint(ctx.accounts.config.project_mint)?;
    let seed = vrf::match_seed(match_id, &nonce)?;
    require!(
        match_id == ctx.accounts.config.total_matches,
        GameError::InvalidHeadEntry
    );

    // Resolve and validate the heads head. Inactive holes are NOT skipped
    // here: use `advance_head` to move past them. This keeps match creation
    // and hole management as separate, auditable steps and guarantees no
    // half-created match accounts.
    let heads_seq = ctx.accounts.config.heads_head;
    require_keys_eq!(
        ctx.accounts.head_heads.key(),
        queue_pda(SIDE_HEADS, heads_seq),
        GameError::InvalidHeadEntry
    );
    let mut heads_entry_data = ctx.accounts.head_heads.try_borrow_mut_data()?;
    let mut heads_entry =
        QueueEntry::try_deserialize(&mut &heads_entry_data[..])
            .map_err(|_| GameError::HeadNotActive)?;
    require!(
        heads_entry.status == EntryStatus::Active,
        GameError::HeadNotActive
    );
    require!(heads_entry.side == SIDE_HEADS, GameError::HeadWrongSide);

    // Same for the tails head.
    let tails_seq = ctx.accounts.config.tails_head;
    require_keys_eq!(
        ctx.accounts.head_tails.key(),
        queue_pda(SIDE_TAILS, tails_seq),
        GameError::InvalidHeadEntry
    );
    let mut tails_entry_data = ctx.accounts.head_tails.try_borrow_mut_data()?;
    let mut tails_entry =
        QueueEntry::try_deserialize(&mut &tails_entry_data[..])
            .map_err(|_| GameError::HeadNotActive)?;
    require!(
        tails_entry.status == EntryStatus::Active,
        GameError::HeadNotActive
    );
    require!(tails_entry.side == SIDE_TAILS, GameError::HeadWrongSide);
    // Invalid historical heads retain exact refunds; never skip or normalize.
    denomination::validate_stake(TIER_1_USD, heads_entry.amount)?;
    denomination::validate_stake(TIER_1_USD, tails_entry.amount)?;

    // Nobody can be matched with themselves. Checked before any player
    // state is borrowed so a duplicated state account fails cleanly here
    // instead of tripping the runtime borrow checker.
    require!(
        heads_entry.player != tails_entry.player,
        GameError::SelfMatch
    );

    // Both players must still hold the queued position they claim.
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
            && heads_state.queued_sequence == heads_seq,
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
            && tails_state.queued_sequence == tails_seq,
        GameError::EntryNotActive
    );

    // Flip both heads to Matched: the race winner. A competing transaction
    // re-validates against already-Matched entries and skips/fails.
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
    heads_state.match_tier_usd = TIER_1_USD;
    tails_state.queued = false;
    tails_state.queued_tier_usd = 0;
    tails_state.in_match = true;
    tails_state.match_id = match_id;
    tails_state.match_tier_usd = TIER_1_USD;
    heads_state
        .try_serialize(&mut &mut heads_state_data[..])
        .map_err(|_| GameError::ArithmeticError)?;
    tails_state
        .try_serialize(&mut &mut tails_state_data[..])
        .map_err(|_| GameError::ArithmeticError)?;

    ctx.accounts.config.heads_head = heads_seq
        .checked_add(1)
        .ok_or(GameError::ArithmeticError)?;
    ctx.accounts.config.tails_head = tails_seq
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
    game_match.tier_usd = TIER_1_USD;
    game_match.created_slot = slot;
    game_match.state = MatchState::WaitingForRandomness;
    game_match.seed = seed;
    game_match.result = None;
    game_match.winner = None;
    game_match.settled_slot = None;
    game_match.bump = ctx.bumps.game_match;

    // Request ORAO VRF exactly once for this match. The caller funds the
    // request account and fee; the seed binds the randomness to this match.
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
        tier_usd: TIER_1_USD,
        seed,
        slot,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Advance: permissionless hole skipping. Moves one queue head past a
// provably inactive (cancelled/matched) entry. Anyone may call it; it moves
// no funds and only advances over entries that can never match.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct AdvanceHead<'info> {
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, GameConfig>,
    /// CHECK: verified in handler against the current head of `side`.
    #[account(mut)]
    pub head_entry: UncheckedAccount<'info>,
}

pub fn handle_advance_head(ctx: Context<AdvanceHead>, side: u8) -> Result<()> {
    require!(
        side == SIDE_HEADS || side == SIDE_TAILS,
        GameError::InvalidSide
    );
    let head_seq = if side == SIDE_HEADS {
        ctx.accounts.config.heads_head
    } else {
        ctx.accounts.config.tails_head
    };
    require_keys_eq!(
        ctx.accounts.head_entry.key(),
        queue_pda(side, head_seq),
        GameError::InvalidHeadEntry
    );
    let mut entry_data = ctx.accounts.head_entry.try_borrow_mut_data()?;
    let entry = QueueEntry::try_deserialize(&mut &entry_data[..])
        .map_err(|_| GameError::HeadNotActive)?;
    require!(entry.side == side, GameError::HeadWrongSide);
    // Only inactive entries may be skipped. Active heads must be matched,
    // never skipped.
    require!(
        entry.status != EntryStatus::Active,
        GameError::HeadNotActive
    );
    if side == SIDE_HEADS {
        ctx.accounts.config.heads_head = head_seq
            .checked_add(1)
            .ok_or(GameError::ArithmeticError)?;
    } else {
        ctx.accounts.config.tails_head = head_seq
            .checked_add(1)
            .ok_or(GameError::ArithmeticError)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Settle: permissionless. Anyone may trigger it (winner, loser, keeper);
// the program alone computes the winner, the destination and the amount.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct SettleMatch<'info> {
    /// Caller only pays fees/geometry. Never the payout destination.
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [b"match", &match_id.to_le_bytes()], bump)]
    pub game_match: Account<'info, Match>,
    /// CHECK: ORAO randomness PDA; address, owner, fulfillment and seed
    /// binding verified in handler.
    pub randomness: UncheckedAccount<'info>,
    /// CHECK: heads player state; address verified in handler.
    #[account(mut)]
    pub heads_state: UncheckedAccount<'info>,
    /// CHECK: tails player state; address verified in handler.
    #[account(mut)]
    pub tails_state: UncheckedAccount<'info>,
    pub project_mint: Account<'info, anchor_spl::token::Mint>,
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
    /// CHECK: must equal the computed winner's ATA for the project mint;
    /// owner and mint verified in handler.
    #[account(mut)]
    pub winner_tokens: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_settle_match(ctx: Context<SettleMatch>, match_id: u64) -> Result<()> {
    let game_match = &mut ctx.accounts.game_match;
    require!(game_match.id == match_id, GameError::InvalidHeadEntry);
    require!(
        game_match.state == MatchState::WaitingForRandomness,
        if game_match.state == MatchState::Settled {
            GameError::AlreadySettled
        } else {
            GameError::MatchNotAwaitingRandomness
        }
    );
    // Note: token-mint enforcement happens through Anchor's token::mint
    // constraints on the vault (see context structs) plus the explicit
    // winner-token mint check below.

    // Validate the exact randomness request for this match and read it.
    let randomness =
        vrf::read_fulfilled_randomness(&ctx.accounts.randomness, &game_match.seed)?;
    let result = vrf::result_from_randomness(&randomness);
    let winner = match result {
        FlipResult::Heads => game_match.heads_player,
        FlipResult::Tails => game_match.tails_player,
    };

    // The payout destination is derived, never caller-supplied.
    let expected_ata =
        get_associated_token_address(&winner, &ctx.accounts.config.project_mint);
    require_keys_eq!(
        ctx.accounts.winner_tokens.key(),
        expected_ata,
        GameError::WrongWinnerAccount
    );
    let winner_data = ctx.accounts.winner_tokens.try_borrow_data()?;
    let winner_token =
        TokenAccount::try_deserialize(&mut &winner_data[..])
            .map_err(|_| GameError::WrongWinnerAccount)?;
    require_keys_eq!(winner_token.owner, winner, GameError::WinnerOwnerMismatch);
    require_keys_eq!(
        winner_token.mint,
        ctx.accounts.config.project_mint,
        GameError::WinnerMintMismatch
    );
    drop(winner_data);

    let pot = game_match.total_pot;
    let seeds: &[&[u8]] = &[
        b"vault-authority",
        &[ctx.accounts.config.authority_bump],
    ];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.winner_tokens.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
                mint: ctx.accounts.project_mint.to_account_info(),
            },
            &[seeds],
        ),
        pot,
        ctx.accounts.project_mint.decimals,
    )?;

    // Clear both players so they can play again.
    let mut heads_state_data = ctx.accounts.heads_state.try_borrow_mut_data()?;
    let mut heads_state =
        PlayerState::try_deserialize(&mut &heads_state_data[..])
            .map_err(|_| GameError::InvalidHeadEntry)?;
    require_keys_eq!(
        ctx.accounts.heads_state.key(),
        Pubkey::find_program_address(
            &[b"player", game_match.heads_player.as_ref()],
            &crate::ID
        )
        .0,
        GameError::InvalidHeadEntry
    );
    heads_state.in_match = false;
    heads_state.match_tier_usd = 0;

    let mut tails_state_data = ctx.accounts.tails_state.try_borrow_mut_data()?;
    let mut tails_state =
        PlayerState::try_deserialize(&mut &tails_state_data[..])
            .map_err(|_| GameError::InvalidHeadEntry)?;
    require_keys_eq!(
        ctx.accounts.tails_state.key(),
        Pubkey::find_program_address(
            &[b"player", game_match.tails_player.as_ref()],
            &crate::ID
        )
        .0,
        GameError::InvalidHeadEntry
    );
    tails_state.in_match = false;
    tails_state.match_tier_usd = 0;

    heads_state
        .try_serialize(&mut &mut heads_state_data[..])
        .map_err(|_| GameError::ArithmeticError)?;
    tails_state
        .try_serialize(&mut &mut tails_state_data[..])
        .map_err(|_| GameError::ArithmeticError)?;

    game_match.state = MatchState::Settled;
    game_match.result = Some(result);
    game_match.winner = Some(winner);
    let slot = Clock::get()?.slot;
    game_match.settled_slot = Some(slot);

    emit!(MatchSettled {
        match_id: game_match.id,
        result: result.side(),
        winner,
        pot,
        slot,
    });
    Ok(())
}


