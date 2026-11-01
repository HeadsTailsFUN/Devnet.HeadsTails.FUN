use anchor_lang::{prelude::*, Discriminator, solana_program::program_option::COption};
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::{denomination, errors::GameError, state::*};

pub const HTS_INITIAL_SUPPLY: u64 = 1_000_000_000_000_000;

/// A separate config and vault bind this generation to an owner-selected mint.
/// No instruction can replace that mint or move the original vault's tokens.
#[derive(Accounts)]
pub struct InitializeHts<'info> {
    pub admin: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump)]
    pub legacy_config: Account<'info, GameConfig>,
    pub project_mint: Account<'info, Mint>,
    #[account(init, payer = payer, space = 8 + GameConfig::INIT_SPACE, seeds = [b"hts-config"], bump)]
    pub config: Account<'info, GameConfig>,
    /// CHECK: canonical HTS vault authority, verified by seeds.
    #[account(seeds = [b"hts-vault-authority"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(init, payer = payer, seeds = [b"hts-vault"], bump, token::mint = project_mint, token::authority = vault_authority)]
    pub vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_initialize_hts(ctx: Context<InitializeHts>) -> Result<()> {
    require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.legacy_config.authority, GameError::Unauthorized);
    require!(ctx.accounts.legacy_config.paused, GameError::LegacyIntakeMustBePaused);
    require_keys_neq!(ctx.accounts.project_mint.key(), denomination::DEVNET_MINT, GameError::WrongProjectMint);
    require!(ctx.accounts.project_mint.decimals == 6, GameError::WrongMintDecimals);
    require!(ctx.accounts.project_mint.supply == HTS_INITIAL_SUPPLY, GameError::InvalidHtsIssuance);
    require!(ctx.accounts.project_mint.mint_authority == COption::Some(ctx.accounts.admin.key())
        && ctx.accounts.project_mint.freeze_authority == COption::None, GameError::InvalidHtsIssuance);
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.admin.key();
    config.project_mint = ctx.accounts.project_mint.key();
    config.paused = true;
    config.tier1_active = false;
    config.heads_head = 0;
    config.heads_next = 0;
    config.tails_head = 0;
    config.tails_next = 0;
    config.total_matches = ctx.accounts.legacy_config.total_matches;
    config.vault_bump = ctx.bumps.vault;
    config.authority_bump = ctx.bumps.vault_authority;
    config.config_bump = ctx.bumps.config;
    Ok(())
}

#[derive(Accounts)]
pub struct HtsAdminConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"hts-config"], bump, has_one = authority @ GameError::Unauthorized)]
    pub config: Account<'info, GameConfig>,
    /// CHECK: address only; admin must be this address and sign below.
    pub authority: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump)]
    pub legacy_config: Account<'info, GameConfig>,
}

pub fn handle_set_hts_paused(ctx: Context<HtsAdminConfig>, paused: bool) -> Result<()> {
    require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.config.authority, GameError::Unauthorized);
    if !paused { require!(ctx.accounts.legacy_config.paused, GameError::LegacyIntakeMustBePaused); }
    ctx.accounts.config.paused = paused;
    Ok(())
}

pub fn validate_bound_mint(config: &GameConfig, mint: Pubkey, decimals: u8) -> Result<()> {
    require_keys_eq!(mint, config.project_mint, GameError::WrongProjectMint);
    require_keys_neq!(mint, denomination::DEVNET_MINT, GameError::WrongProjectMint);
    require!(decimals == 6, GameError::WrongMintDecimals);
    Ok(())
}

/// Decode either historical player layout without reallocating or writing it.
fn validate_legacy_idle_bytes(data: &[u8], owner: Pubkey) -> Result<()> {
    require!(data.len() == 60 || data.len() == 62, GameError::PlayerStateDataInvalid);
    require!(data[..8] == PlayerState::DISCRIMINATOR[..], GameError::PlayerStateDataInvalid);
    require!(data[8..40] == owner.to_bytes(), GameError::Unauthorized);
    require!(data[40] <= 1 && data[41] <= 1 && data[50] <= 1, GameError::PlayerStateDataInvalid);
    require!(data[40] == 0 && data[50] == 0, GameError::AlreadyActive);
    Ok(())
}

pub fn require_legacy_idle(account: &UncheckedAccount, owner: Pubkey) -> Result<()> {
    // Anchor verified the canonical PDA. Absent accounts have system ownership
    // and empty data. Any other ownership or malformed state fails closed.
    if account.data_is_empty() {
        require_keys_eq!(*account.owner, anchor_lang::system_program::ID, GameError::PlayerStateDataInvalid);
        return Ok(());
    }
    require_keys_eq!(*account.owner, crate::ID, GameError::PlayerStateDataInvalid);
    validate_legacy_idle_bytes(&account.try_borrow_data()?, owner)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_guard_accepts_idle_only_and_preserves_both_layouts() {
        let player = Pubkey::new_unique();
        for len in [60, 62] {
            let mut bytes = vec![0; len];
            bytes[..8].copy_from_slice(PlayerState::DISCRIMINATOR);
            bytes[8..40].copy_from_slice(player.as_ref());
            let original = bytes.clone();
            assert!(validate_legacy_idle_bytes(&bytes, player).is_ok());
            assert_eq!(bytes, original);
            bytes[40] = 1;
            assert!(validate_legacy_idle_bytes(&bytes, player).is_err());
            bytes[40] = 0; bytes[50] = 1;
            assert!(validate_legacy_idle_bytes(&bytes, player).is_err());
            bytes[50] = 0; bytes[41] = 2;
            assert!(validate_legacy_idle_bytes(&bytes, player).is_err());
        }
        assert!(validate_legacy_idle_bytes(&[0; 59], player).is_err());
    }
}
