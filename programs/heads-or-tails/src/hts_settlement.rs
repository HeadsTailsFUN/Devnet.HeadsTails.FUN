use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::{errors::GameError, events::*, state::*, vrf, hts::validate_bound_mint};

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct HtsSettleMatch<'info> {
    /// Caller only pays fees/geometry. Never the payout destination.
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [b"hts-config"], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [b"hts-match", &match_id.to_le_bytes()], bump)]
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
        seeds = [b"hts-vault"],
        bump,
        token::mint = project_mint,
    )]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: PDA authority of the vault; address verified by seeds.
    #[account(seeds = [b"hts-vault-authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: must equal the computed winner's ATA for the project mint;
    /// owner and mint verified in handler.
    #[account(mut)]
    pub winner_tokens: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_hts_settle_match(ctx: Context<HtsSettleMatch>, match_id: u64) -> Result<()> {
    validate_bound_mint(&ctx.accounts.config, ctx.accounts.project_mint.key(), ctx.accounts.project_mint.decimals)?;
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
        b"hts-vault-authority",
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
            &[b"hts-player", game_match.heads_player.as_ref()],
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
            &[b"hts-player", game_match.tails_player.as_ref()],
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


